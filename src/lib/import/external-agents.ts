import path from 'node:path';
import { stat } from 'node:fs/promises';
import {
  getProvider,
  type LocalHistoryEvent,
  type LocalHistoryOps,
  type LocalHistorySession,
} from '@agentex/agent';
import { and, inArray, isNotNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '@/lib/db';
import {
  chatEvents,
  chatSessions,
  executions,
} from '@/lib/db/schema';
import {
  createWorkspace,
  getOrCreateDefaultExecutor,
  listWorkspaces,
} from '@/lib/db/queries';
import { parseStreamEvent } from '@/lib/executor/adapter';
import { explicitAgentSelection } from '@/lib/agent-options';
import { detectBaseBranch, detectIsGit } from '@/lib/workspaces';
import type { CreateChatEventInput } from '@/db/types';
import type {
  ExternalAgentDiscovery,
  ExternalAgentImportResult,
  ExternalAgentProjectCandidate,
  ExternalAgentSessionCandidate,
  ExternalAgentSource,
} from './types';

const MAX_IMPORT_SELECTION = 1_000;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTERNAL_AGENT_SOURCES = ['claude', 'codex'] as const satisfies readonly ExternalAgentSource[];

interface InternalCandidate extends ExternalAgentSessionCandidate {
  history: LocalHistoryOps;
  historySession: LocalHistorySession;
}

function sessionKey(source: ExternalAgentSource, externalSessionId: string): string {
  return `${source}:${externalSessionId}`;
}

function cleanLabel(value: string | null, fallback: string): string {
  const cleaned = value
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\[\[[^\]]+\]\]/g, ' ')
    .replace(/^[#>*_`\s-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > 120 ? `${cleaned.slice(0, 117).trimEnd()}...` : cleaned;
}

function normalizeAbsoluteCwd(value: string): string | null {
  return path.isAbsolute(value) ? path.normalize(value) : null;
}

async function pathIsDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

function candidateFromHistory(
  source: ExternalAgentSource,
  history: LocalHistoryOps,
  historySession: LocalHistorySession,
): InternalCandidate | null {
  const id = historySession.externalSessionId;
  const cwd = historySession.cwd ? normalizeAbsoluteCwd(historySession.cwd) : null;
  if (!SESSION_ID_RE.test(id) || !cwd) return null;
  const providerLabel = source === 'claude' ? 'Claude' : 'Codex';
  return {
    key: sessionKey(source, id),
    source,
    externalSessionId: id,
    label: cleanLabel(historySession.title, `${providerLabel} chat ${id.slice(0, 8)}`),
    cwd,
    startedAt: historySession.startedAt ?? historySession.updatedAt,
    updatedAt: historySession.updatedAt,
    branchName: historySession.branch,
    imported: false,
    history,
    historySession,
  };
}

async function mapLimited<T, U>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

async function discoverCandidatesInternal(): Promise<{
  candidates: InternalCandidate[];
  available: Record<ExternalAgentSource, boolean>;
}> {
  const discovered = await Promise.all(EXTERNAL_AGENT_SOURCES.map(async (source) => {
    const history = getProvider(source).localHistory;
    if (!history) return { source, available: false, candidates: [] as InternalCandidate[] };

    const probe = await history.probe().catch(() => null);
    const candidates: InternalCandidate[] = [];
    try {
      for await (const historySession of history.discover({
        includeArchived: true,
        mainSessionsOnly: true,
        requireUserMessage: true,
      })) {
        const candidate = candidateFromHistory(source, history, historySession);
        if (candidate) candidates.push(candidate);
      }
    } catch {
      // Discovery failures are isolated per provider. A healthy store can
      // still be imported when another local agent store is unreadable.
    }
    return {
      source,
      available: probe?.homeAvailable ?? candidates.length > 0,
      candidates,
    };
  }));

  // A session can briefly exist in active and archived locations during a move.
  // Keep the newest physical copy and expose one candidate.
  const deduped = new Map<string, InternalCandidate>();
  for (const provider of discovered) {
    for (const candidate of provider.candidates) {
      const prior = deduped.get(candidate.key);
      if (!prior || candidate.updatedAt > prior.updatedAt) deduped.set(candidate.key, candidate);
    }
  }
  return {
    candidates: [...deduped.values()],
    available: {
      claude: discovered.find((provider) => provider.source === 'claude')?.available ?? false,
      codex: discovered.find((provider) => provider.source === 'codex')?.available ?? false,
    },
  };
}

export async function discoverExternalAgentSessions(): Promise<ExternalAgentDiscovery> {
  const { candidates, available } = await discoverCandidatesInternal();
  const externalIds = [...new Set(candidates.map((candidate) => candidate.externalSessionId))];
  const importedIds = new Set<string>();
  if (externalIds.length > 0) {
    const db = getDb();
    // Chunk to stay below SQLite's variable limit on large histories.
    for (let i = 0; i < externalIds.length; i += 400) {
      const rows = db
        .select({ externalSessionId: chatSessions.externalSessionId })
        .from(chatSessions)
        .where(and(isNotNull(chatSessions.externalSessionId), inArray(chatSessions.externalSessionId, externalIds.slice(i, i + 400))))
        .all();
      for (const row of rows) if (row.externalSessionId) importedIds.add(row.externalSessionId);
    }
  }
  for (const candidate of candidates) {
    candidate.imported = importedIds.has(candidate.externalSessionId);
  }

  candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const grouped = new Map<string, InternalCandidate[]>();
  for (const candidate of candidates) {
    const rows = grouped.get(candidate.cwd) ?? [];
    rows.push(candidate);
    grouped.set(candidate.cwd, rows);
  }
  const projects: ExternalAgentProjectCandidate[] = await mapLimited(
    [...grouped.entries()],
    24,
    async ([cwd, sessions]) => ({
      id: cwd,
      name: path.basename(cwd) || cwd,
      cwd,
      pathExists: await pathIsDirectory(cwd),
      sessions: sessions.map((session) => ({
        key: session.key,
        source: session.source,
        externalSessionId: session.externalSessionId,
        label: session.label,
        cwd: session.cwd,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt,
        branchName: session.branchName,
        imported: session.imported,
      })),
    }),
  );
  projects.sort((a, b) => (b.sessions[0]?.updatedAt ?? '').localeCompare(a.sessions[0]?.updatedAt ?? ''));

  const sourceSummary = (source: ExternalAgentSource) => {
    const matching = candidates.filter((candidate) => candidate.source === source);
    return {
      available: available[source],
      found: matching.length,
      imported: matching.filter((candidate) => candidate.imported).length,
    };
  };
  return {
    projects,
    sources: {
      claude: sourceSummary('claude'),
      codex: sourceSummary('codex'),
    },
    scannedAt: new Date().toISOString(),
  };
}

function historyEventInput(
  event: LocalHistoryEvent & { eventId: string },
  partIndex: number,
): CreateChatEventInput | null {
  const shared = {
    externalEventId: event.eventId,
    externalMessageId: event.messageId,
    externalTurnId: event.turnId,
    externalParentToolCallId: event.parentToolCallId,
    sourcePartIndex: partIndex,
  };
  if (event.type !== 'user') {
    const input = parseStreamEvent('', event);
    return input ? { ...input, ...shared } : null;
  }
  return {
    sessionId: '',
    role: 'user',
    source: 'user',
    content: event.text,
    raw: event.raw,
    createdAt: event.timestamp,
    ...shared,
  };
}

async function parseHistoryTranscript(candidate: InternalCandidate): Promise<CreateChatEventInput[]> {
  const inputs: CreateChatEventInput[] = [];
  for await (const yielded of candidate.history.read(candidate.historySession)) {
    const input = historyEventInput(yielded.event, yielded.partIndex);
    if (input) inputs.push(input);
  }
  return inputs;
}

async function ensureImportWorkspace(candidate: InternalCandidate): Promise<{ id: string; created: boolean }> {
  const resolvedCwd = path.normalize(candidate.cwd);
  const existing = listWorkspaces().find((workspace) => path.normalize(workspace.cwd) === resolvedCwd);
  if (existing) return { id: existing.id, created: false };

  const isGit = await detectIsGit(resolvedCwd);
  const baseBranch = isGit ? await detectBaseBranch(resolvedCwd) : null;
  const created = createWorkspace({
    name: path.basename(resolvedCwd) || resolvedCwd,
    cwd: resolvedCwd,
    emoji: candidate.source === 'claude' ? '🟠' : '🟢',
    attachments: [],
    isGit,
    baseBranch,
    remoteName: isGit ? 'origin' : null,
    worktreeRoot: null,
    areaId: null,
    status: 'active',
  });
  return { id: created.id, created: true };
}

function insertImportedSession(
  candidate: InternalCandidate,
  workspaceId: string,
  eventInputs: CreateChatEventInput[],
): number {
  const db = getDb();
  const harness = candidate.source === 'claude' ? 'claude_code' : 'codex';
  const providerId = candidate.source === 'claude' ? 'claude' : 'codex';
  const agent = getOrCreateDefaultExecutor(harness);
  const selection = explicitAgentSelection(providerId, {});
  const executionId = uuidv7();
  const chatSessionId = uuidv7();
  const archivedAt = candidate.updatedAt;
  const lastExternalEventId = [...eventInputs].reverse()
    .find((event) => event.externalEventId)?.externalEventId ?? null;

  return db.transaction((tx) => {
    tx.insert(executions).values({
      id: executionId,
      workspaceId,
      label: candidate.label,
      branchName: candidate.branchName,
      status: 'archived',
      archivedAt,
      createdAt: candidate.startedAt,
      updatedAt: candidate.updatedAt,
    }).run();
    tx.insert(chatSessions).values({
      id: chatSessionId,
      agentId: agent.id,
      type: 'execution',
      surfaceKind: 'imported_agent',
      surfaceRef: candidate.source,
      status: 'archived',
      label: candidate.label,
      workspaceId,
      executionId,
      lastOutcomeEventAt: candidate.updatedAt,
      lastViewedAt: candidate.updatedAt,
      externalSessionId: candidate.externalSessionId,
      externalTranscriptPath: candidate.historySession.transcriptPath,
      externalSyncOffset: candidate.historySession.source.size,
      externalSyncLastEventId: lastExternalEventId,
      permissionMode: 'bypass',
      model: selection.model,
      effort: selection.effort,
      startedAt: candidate.startedAt,
      archivedAt,
      createdAt: candidate.startedAt,
      updatedAt: candidate.updatedAt,
    }).run();

    let inserted = 0;
    for (let index = 0; index < eventInputs.length; index += 100) {
      const chunk = eventInputs.slice(index, index + 100).map((input) => {
        return {
          ...input,
          id: input.id ?? uuidv7(),
          sessionId: chatSessionId,
          attachments: undefined,
          createdAt: input.createdAt ?? candidate.startedAt,
          updatedAt: input.updatedAt ?? input.createdAt ?? candidate.startedAt,
        };
      });
      if (chunk.length === 0) continue;
      inserted += tx.insert(chatEvents).values(chunk).onConflictDoNothing().run().changes;
    }
    return inserted;
  });
}

export async function importExternalAgentSessions(sessionKeys: string[]): Promise<ExternalAgentImportResult> {
  const uniqueKeys = [...new Set(sessionKeys)];
  if (uniqueKeys.length === 0) {
    return { importedSessions: 0, importedEvents: 0, createdWorkspaces: 0, skippedSessions: 0, failures: [] };
  }
  if (uniqueKeys.length > MAX_IMPORT_SELECTION) {
    throw new Error(`Select at most ${MAX_IMPORT_SELECTION} chats per import.`);
  }
  for (const key of uniqueKeys) {
    const [source, id, extra] = key.split(':');
    if (extra || (source !== 'claude' && source !== 'codex') || !SESSION_ID_RE.test(id ?? '')) {
      throw new Error(`Invalid session key: ${key}`);
    }
  }

  const { candidates } = await discoverCandidatesInternal();
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const db = getDb();
  const selectedIds = uniqueKeys.map((key) => key.split(':')[1]);
  const alreadyImported = new Set(
    db.select({ externalSessionId: chatSessions.externalSessionId })
      .from(chatSessions)
      .where(and(isNotNull(chatSessions.externalSessionId), inArray(chatSessions.externalSessionId, selectedIds)))
      .all()
      .flatMap((row) => row.externalSessionId ? [row.externalSessionId] : []),
  );

  const result: ExternalAgentImportResult = {
    importedSessions: 0,
    importedEvents: 0,
    createdWorkspaces: 0,
    skippedSessions: 0,
    failures: [],
  };
  const workspaceByCwd = new Map<string, string>();
  for (const key of uniqueKeys) {
    const candidate = byKey.get(key);
    if (!candidate) {
      result.failures.push({ key, error: 'The local transcript was not found.' });
      continue;
    }
    if (alreadyImported.has(candidate.externalSessionId)) {
      result.skippedSessions++;
      continue;
    }
    try {
      let workspaceId = workspaceByCwd.get(candidate.cwd);
      if (!workspaceId) {
        const workspace = await ensureImportWorkspace(candidate);
        workspaceId = workspace.id;
        workspaceByCwd.set(candidate.cwd, workspaceId);
        if (workspace.created) result.createdWorkspaces++;
      }
      const events = await parseHistoryTranscript(candidate);
      result.importedEvents += insertImportedSession(candidate, workspaceId, events);
      result.importedSessions++;
      alreadyImported.add(candidate.externalSessionId);
    } catch (error) {
      result.failures.push({
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
