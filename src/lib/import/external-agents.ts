import path from 'node:path';
import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import {
  getProvider,
  type HistoryCheckpoint,
  type LocalHistoryEvent,
  type LocalHistoryOps,
  type LocalHistorySession,
  type ProviderRuntimeContext,
  type SavedHistoryEvent,
  type SavedHistoryOps,
  type SavedHistorySession,
} from '@agentex/agent';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '@/lib/db';
import {
  chatEvents,
  chatSessions,
  executions,
  externalSessionImports,
  workspaces,
} from '@/lib/db/schema';
import {
  createWorkspace,
  getChatSessionWithExecution,
  getExternalSessionImportForChat,
  getOrCreateDefaultExecutor,
  getWorkspace,
  listWorkspaces,
  updateChatSession,
  updateExecution,
} from '@/lib/db/queries';
import { parseStreamEvent } from '@/lib/executor/adapter';
import {
  publishReconcileStarted,
  publishReconcileDone,
} from '@/lib/realtime/bus';
import { explicitAgentSelection } from '@/lib/agent-options';
import { openCodeRuntimeContext } from '@/lib/agents/opencode';
import { runtimeContextForHarness } from '@/lib/agents/runtime';
import { getAppRoot } from '@/lib/config/paths';
import { detectBaseBranch, detectIsGit } from '@/lib/workspaces';
import type {
  CreateChatEventInput,
  ExternalSessionImportRecord,
  UpdateExternalSessionImportInput,
} from '@/db/types';
import type {
  ExternalAgentDiscovery,
  ExternalAgentImportResult,
  ExternalAgentImportStatus,
  ExternalAgentProjectCandidate,
  ExternalAgentSessionCandidate,
  ExternalAgentSource,
} from './types';

const MAX_IMPORT_SELECTION = 1_000;
const MAX_EXTERNAL_SESSION_ID_LENGTH = 512;
const EVENT_BATCH_SIZE = 100;
// How much normalized history is held in memory before it is committed. This
// bounds memory, not transcript size: a long chat is imported as a sequence of
// windows, each one leaving the ledger on a resumable prefix. Transcripts of a
// few hundred MB are ordinary for long-running agents.
//
// Bigger windows buy nothing. Measured on a 114MB Claude transcript (32k
// events), 8 MiB against 128 MiB was a wash on wall time — ~6.8s vs ~7.3s
// median over six paired runs, well inside run-to-run noise, because the work
// is linear in transcript size either way. What did scale with the window was
// the worst event-loop stall: 0.25-0.8s at 8 MiB against 1.8-3.3s at 128 MiB,
// with one run reaching 12s. Both the synchronous SQLite commit and the major
// GC that follows releasing a window block the loop, and this process also
// serves the UI and terminals, so the window stays small enough that an import
// never freezes the app.
const HISTORY_WINDOW_BYTES = 8 * 1024 * 1024;
const EXTERNAL_AGENT_SOURCES = ['claude', 'codex', 'opencode'] as const satisfies readonly ExternalAgentSource[];
// NUL, because it is the one byte a provider session id may never contain
// (`validExternalSessionId` rejects it), so `source + id` can't be ambiguous.
// Spelled this way rather than inline so the file stays free of raw control
// bytes that make grep treat it as binary.
const SYNC_LOCK_SEPARATOR = String.fromCharCode(0);
const sourceSyncTails = new Map<string, Promise<void>>();

interface CandidateBase extends ExternalAgentSessionCandidate {
  kind: 'file' | 'service';
}

interface FileCandidate extends CandidateBase {
  kind: 'file';
  history: LocalHistoryOps;
  historySession: LocalHistorySession;
}

interface ServiceCandidate extends CandidateBase {
  kind: 'service';
  history: SavedHistoryOps;
  historySession: SavedHistorySession;
  runtime: Pick<ProviderRuntimeContext, 'cwd' | 'env' | 'config'>;
}

type InternalCandidate = FileCandidate | ServiceCandidate;

interface PendingHistoryEvent {
  input: CreateChatEventInput;
  /** Service sources only — the bookmark this event may be committed against. */
  checkpoint?: HistoryCheckpoint;
}

function providerLabel(source: ExternalAgentSource): string {
  if (source === 'claude') return 'Claude';
  if (source === 'codex') return 'Codex';
  return 'OpenCode';
}

function validExternalSessionId(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_EXTERNAL_SESSION_ID_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function sessionKey(source: ExternalAgentSource, externalSessionId: string): string {
  return `${source}:${Buffer.from(externalSessionId, 'utf8').toString('base64url')}`;
}

/**
 * Identity of one provider session: what the ledger lookup maps are keyed by,
 * and what every path that advances a ledger cursor locks on. Because the
 * settings-panel import, the per-session sync, and the cold-start sweep all
 * derive it the same way, none of them can replay a transcript window another
 * one is already committing.
 */
function syncLockKey(source: ExternalAgentSource, externalSessionId: string): string {
  return `${source}${SYNC_LOCK_SEPARATOR}${externalSessionId}`;
}

async function withSourceSyncLock<T>(sourceIdentity: string, action: () => Promise<T>): Promise<T> {
  const previous = sourceSyncTails.get(sourceIdentity) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  sourceSyncTails.set(sourceIdentity, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (sourceSyncTails.get(sourceIdentity) === tail) sourceSyncTails.delete(sourceIdentity);
  }
}

function parseSessionKey(key: string): { source: ExternalAgentSource; externalSessionId: string } | null {
  const separator = key.indexOf(':');
  if (separator <= 0 || separator === key.length - 1) return null;
  const source = key.slice(0, separator);
  if (!EXTERNAL_AGENT_SOURCES.includes(source as ExternalAgentSource)) return null;
  try {
    const externalSessionId = Buffer.from(key.slice(separator + 1), 'base64url').toString('utf8');
    if (!validExternalSessionId(externalSessionId)) return null;
    return { source: source as ExternalAgentSource, externalSessionId };
  } catch {
    return null;
  }
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

interface PrefixDigest {
  /** sha256 of `[0, offset)`. Offsets must be requested in ascending order. */
  at(offset: number): Promise<string>;
}

/**
 * Rolling sha256 over the transcript bytes an import has consumed so far.
 * Every committed window has to leave the ledger describing a *prefix* of the
 * file, and re-hashing `[0, offset)` once per window would be quadratic on a
 * long transcript, so hash forward once and snapshot the digest at each
 * boundary.
 */
function createPrefixDigest(filePath: string): PrefixDigest {
  const hash = createHash('sha256');
  let hashedTo = 0;
  return {
    async at(offset: number): Promise<string> {
      if (offset < hashedTo) {
        throw codedError(
          'source_changed_during_read',
          'The provider transcript rewound while it was being synchronized.',
        );
      }
      if (offset > hashedTo) {
        const handle = await open(filePath, 'r');
        const buffer = Buffer.allocUnsafe(64 * 1024);
        try {
          while (hashedTo < offset) {
            const length = Math.min(buffer.length, offset - hashedTo);
            const { bytesRead } = await handle.read(buffer, 0, length, hashedTo);
            if (bytesRead === 0) {
              throw codedError('source_changed_during_read', 'The provider transcript became shorter while it was read.');
            }
            hash.update(buffer.subarray(0, bytesRead));
            hashedTo += bytesRead;
          }
        } finally {
          await handle.close();
        }
      }
      return hash.copy().digest('hex');
    },
  };
}

async function sha256Prefix(filePath: string, byteLength: number): Promise<string> {
  return createPrefixDigest(filePath).at(byteLength);
}

function baseCandidate(
  source: ExternalAgentSource,
  session: Pick<SavedHistorySession, 'externalSessionId' | 'cwd' | 'title' | 'startedAt' | 'updatedAt' | 'branch'>,
): ExternalAgentSessionCandidate | null {
  const id = session.externalSessionId;
  const cwd = session.cwd ? normalizeAbsoluteCwd(session.cwd) : null;
  if (!validExternalSessionId(id) || !cwd) return null;
  return {
    key: sessionKey(source, id),
    source,
    externalSessionId: id,
    label: cleanLabel(session.title, `${providerLabel(source)} chat ${id.slice(0, 8)}`),
    cwd,
    startedAt: session.startedAt ?? session.updatedAt,
    updatedAt: session.updatedAt,
    branchName: session.branch,
    imported: false,
    importStatus: 'not_imported',
  };
}

function fileCandidate(
  source: ExternalAgentSource,
  history: LocalHistoryOps,
  historySession: LocalHistorySession,
): FileCandidate | null {
  const candidate = baseCandidate(source, historySession);
  return candidate ? { ...candidate, kind: 'file', history, historySession } : null;
}

function serviceCandidate(
  source: ExternalAgentSource,
  history: SavedHistoryOps,
  historySession: SavedHistorySession,
  runtime: Pick<ProviderRuntimeContext, 'cwd' | 'env' | 'config'>,
): ServiceCandidate | null {
  const candidate = baseCandidate(source, historySession);
  return candidate ? { ...candidate, kind: 'service', history, historySession, runtime } : null;
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

async function savedHistoryRuntime(
  source: ExternalAgentSource,
): Promise<Pick<ProviderRuntimeContext, 'cwd' | 'env' | 'config'>> {
  const runtime = source === 'opencode'
    ? await openCodeRuntimeContext()
    : await runtimeContextForHarness(source, { cwd: getAppRoot() });
  return { cwd: runtime.cwd, env: runtime.env, config: runtime.config };
}

async function discoverProvider(source: ExternalAgentSource): Promise<{
  source: ExternalAgentSource;
  available: boolean;
  completed: boolean;
  candidates: InternalCandidate[];
}> {
  const provider = getProvider(source);
  const savedHistory = provider.savedHistory;
  if (savedHistory) {
    const runtime = await savedHistoryRuntime(source);
    const probe = await savedHistory.probe({ ...runtime }).catch(() => null);
    const candidates: InternalCandidate[] = [];
    let completed = false;
    try {
      for await (const historySession of savedHistory.discover({
        includeArchived: true,
        mainSessionsOnly: true,
        requireUserMessage: true,
        ...runtime,
      })) {
        const candidate = serviceCandidate(source, savedHistory, historySession, runtime);
        if (candidate) candidates.push(candidate);
      }
      completed = true;
    } catch {
      // A provider that cannot enumerate history should not prevent healthy
      // providers from appearing in the import surface.
    }
    return {
      source,
      available: Boolean(probe?.sourceAvailable ?? probe?.historyAvailable ?? (candidates.length > 0)),
      completed,
      candidates,
    };
  }

  const localHistory = provider.localHistory;
  if (!localHistory) return { source, available: false, completed: false, candidates: [] };
  const probe = await localHistory.probe().catch(() => null);
  const candidates: InternalCandidate[] = [];
  let completed = false;
  try {
    for await (const historySession of localHistory.discover({
      includeArchived: true,
      mainSessionsOnly: true,
      requireUserMessage: true,
    })) {
      const candidate = fileCandidate(source, localHistory, historySession);
      if (candidate) candidates.push(candidate);
    }
    completed = true;
  } catch {
    // Keep discovery isolated by provider.
  }
  return {
    source,
    available: Boolean(probe?.homeAvailable || probe?.historyAvailable || candidates.length > 0),
    completed,
    candidates,
  };
}

async function discoverCandidatesInternal(): Promise<{
  candidates: InternalCandidate[];
  available: Record<ExternalAgentSource, boolean>;
  completed: Record<ExternalAgentSource, boolean>;
}> {
  const discovered = await Promise.all(EXTERNAL_AGENT_SOURCES.map(discoverProvider));
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
      opencode: discovered.find((provider) => provider.source === 'opencode')?.available ?? false,
    },
    completed: {
      claude: discovered.find((provider) => provider.source === 'claude')?.completed ?? false,
      codex: discovered.find((provider) => provider.source === 'codex')?.completed ?? false,
      opencode: discovered.find((provider) => provider.source === 'opencode')?.completed ?? false,
    },
  };
}

function sourceStatus(
  candidate: InternalCandidate,
  ledger: ExternalSessionImportRecord,
): Exclude<ExternalAgentImportStatus, 'not_imported'> {
  if (ledger.status === 'importing' || ledger.status === 'error') return ledger.status;
  if (ledger.status === 'missing') return 'changed';
  if (candidate.kind === 'service') {
    return ledger.sourceUpdatedAt && candidate.updatedAt <= ledger.sourceUpdatedAt
      ? 'current'
      : 'changed';
  }
  const source = candidate.historySession.source;
  return ledger.sourcePath === candidate.historySession.transcriptPath
    && ledger.sourceSize === source.size
    && ledger.sourceModifiedAtNs === source.modifiedAtNs
    ? 'current'
    : 'changed';
}

function updateScanState(
  ledger: ExternalSessionImportRecord,
  status: Exclude<ExternalAgentImportStatus, 'not_imported'>,
  scannedAt: string,
): void {
  getDb()
    .update(externalSessionImports)
    .set({ status, lastScannedAt: scannedAt, updatedAt: scannedAt })
    .where(eq(externalSessionImports.id, ledger.id))
    .run();
}

export async function discoverExternalAgentSessions(): Promise<ExternalAgentDiscovery> {
  const { candidates, available, completed } = await discoverCandidatesInternal();
  const db = getDb();
  const scannedAt = new Date().toISOString();
  const ledgers = db.select().from(externalSessionImports).all();
  const ledgerBySource = new Map(ledgers.map((ledger) => [
    syncLockKey(ledger.providerType as ExternalAgentSource, ledger.externalSessionId),
    ledger,
  ]));
  const discoveredSources = new Set<string>();

  for (const candidate of candidates) {
    const sourceIdentity = syncLockKey(candidate.source, candidate.externalSessionId);
    discoveredSources.add(sourceIdentity);
    const ledger = ledgerBySource.get(sourceIdentity);
    if (!ledger) continue;
    const status = sourceStatus(candidate, ledger);
    candidate.imported = true;
    candidate.importStatus = status;
    candidate.chatSessionId = ledger.chatSessionId;
    updateScanState(ledger, status, scannedAt);
  }

  const publicCandidates: ExternalAgentSessionCandidate[] = candidates.map((candidate) => ({
    key: candidate.key,
    source: candidate.source,
    externalSessionId: candidate.externalSessionId,
    label: candidate.label,
    cwd: candidate.cwd,
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
    branchName: candidate.branchName,
    imported: candidate.imported,
    importStatus: candidate.importStatus,
    ...(candidate.chatSessionId ? { chatSessionId: candidate.chatSessionId } : {}),
  }));

  const missingRows = db
    .select({
      ledgerId: externalSessionImports.id,
      providerType: externalSessionImports.providerType,
      externalSessionId: externalSessionImports.externalSessionId,
      ledgerStatus: externalSessionImports.status,
      sourceUpdatedAt: externalSessionImports.sourceUpdatedAt,
      lastSyncedAt: externalSessionImports.lastSyncedAt,
      chatSessionId: externalSessionImports.chatSessionId,
      label: chatSessions.label,
      startedAt: chatSessions.startedAt,
      sessionUpdatedAt: chatSessions.updatedAt,
      branchName: executions.branchName,
      cwd: workspaces.cwd,
    })
    .from(externalSessionImports)
    .innerJoin(chatSessions, eq(externalSessionImports.chatSessionId, chatSessions.id))
    .leftJoin(executions, eq(chatSessions.executionId, executions.id))
    .leftJoin(workspaces, eq(chatSessions.workspaceId, workspaces.id))
    .all();

  for (const row of missingRows) {
    const source = row.providerType as ExternalAgentSource;
    if (!EXTERNAL_AGENT_SOURCES.includes(source)) continue;
    const sourceIdentity = syncLockKey(source, row.externalSessionId);
    if (discoveredSources.has(sourceIdentity) || !row.cwd) continue;
    const status: Exclude<ExternalAgentImportStatus, 'not_imported'> = completed[source]
      ? 'missing'
      : row.ledgerStatus;
    if (completed[source] && row.ledgerStatus !== 'missing') {
      const ledger = ledgerBySource.get(sourceIdentity);
      if (ledger) updateScanState(ledger, 'missing', scannedAt);
    }
    publicCandidates.push({
      key: sessionKey(source, row.externalSessionId),
      source,
      externalSessionId: row.externalSessionId,
      label: row.label ?? `${providerLabel(source)} chat ${row.externalSessionId.slice(0, 8)}`,
      cwd: row.cwd,
      startedAt: row.startedAt,
      updatedAt: row.sourceUpdatedAt ?? row.lastSyncedAt ?? row.sessionUpdatedAt,
      branchName: row.branchName,
      imported: true,
      importStatus: status,
      chatSessionId: row.chatSessionId,
    });
  }

  publicCandidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const grouped = new Map<string, ExternalAgentSessionCandidate[]>();
  for (const candidate of publicCandidates) {
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
      sessions,
    }),
  );
  projects.sort((a, b) => (b.sessions[0]?.updatedAt ?? '').localeCompare(a.sessions[0]?.updatedAt ?? ''));

  const sourceSummary = (source: ExternalAgentSource) => {
    const matching = publicCandidates.filter((candidate) => candidate.source === source);
    return {
      available: available[source],
      found: matching.filter((candidate) => candidate.importStatus !== 'missing').length,
      imported: matching.filter((candidate) => candidate.imported).length,
    };
  };
  return {
    projects,
    sources: {
      claude: sourceSummary('claude'),
      codex: sourceSummary('codex'),
      opencode: sourceSummary('opencode'),
    },
    scannedAt,
  };
}

function historyEventInput(
  event: LocalHistoryEvent | SavedHistoryEvent,
  eventId: string,
  partIndex: number,
): CreateChatEventInput | null {
  const shared = {
    externalEventId: eventId,
    externalMessageId: event.messageId,
    externalTurnId: event.turnId,
    externalParentToolCallId: event.parentToolCallId,
    sourcePartIndex: partIndex,
  };
  if (event.type !== 'user') {
    const input = parseStreamEvent('', { ...event, eventId });
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

async function ensureImportWorkspace(
  candidate: InternalCandidate,
): Promise<{ id: string; cwd: string; created: boolean }> {
  const resolvedCwd = path.normalize(candidate.cwd);
  const existing = [
    ...listWorkspaces({ status: 'active' }),
    ...listWorkspaces({ status: 'archived' }),
  ].find((workspace) => path.normalize(workspace.cwd) === resolvedCwd);
  if (existing) return { id: existing.id, cwd: existing.cwd, created: false };

  const pathExists = await pathIsDirectory(resolvedCwd);
  const isGit = pathExists && await detectIsGit(resolvedCwd);
  const baseBranch = isGit ? await detectBaseBranch(resolvedCwd) : null;
  const created = createWorkspace({
    name: path.basename(resolvedCwd) || resolvedCwd,
    cwd: resolvedCwd,
    emoji: candidate.source === 'claude' ? '🟠' : candidate.source === 'codex' ? '🟢' : '🔵',
    attachments: [],
    isGit,
    baseBranch,
    remoteName: isGit ? 'origin' : null,
    worktreeRoot: null,
    areaId: null,
    status: pathExists ? 'active' : 'archived',
    archivedAt: pathExists ? null : new Date().toISOString(),
  });
  return { id: created.id, cwd: created.cwd, created: true };
}

function createImportSkeleton(
  candidate: InternalCandidate,
  workspaceId: string,
  workspaceCwd: string,
): { ledger: ExternalSessionImportRecord; chatSessionId: string; executionId: string } {
  const db = getDb();
  const harness = candidate.source === 'claude' ? 'claude_code' : candidate.source;
  const agent = getOrCreateDefaultExecutor(harness);
  const selection = explicitAgentSelection(candidate.source, {});
  const executionId = uuidv7();
  const chatSessionId = uuidv7();
  const ledgerId = uuidv7();
  return db.transaction((tx) => {
    // Active, not archived. Importing used to archive on arrival, reasoning
    // that a finished transcript isn't live work — but archived executions are
    // absent from the workspace tree and from every active-only list, so an
    // import landed somewhere you could only reach by already knowing to search
    // for it. Importing is an explicit "bring this into the app" action; the
    // result has to be somewhere you can see. Archiving stays available, as a
    // choice the user makes.
    tx.insert(executions).values({
      id: executionId,
      workspaceId,
      label: candidate.label,
      branchName: candidate.branchName,
      status: 'active',
      archivedAt: null,
      // The imported agent ran in the workspace's real folder, so that is where
      // this execution lives — the same shape as a Live-mode session
      // (`worktreePath === workspace.cwd`). Leaving it null read as "git
      // workspace still provisioning", and the first send cut a worktree on a
      // new branch. That was wrong twice over: it contradicts the setup card
      // ("the agent ran wherever the user ran it"), and it moved the cwd, which
      // is what Claude derives its transcript directory from. Once the cwd
      // moved, the imported session became unresumable even by hand.
      worktreePath: workspaceCwd,
      createdAt: candidate.startedAt,
      updatedAt: candidate.updatedAt,
    }).run();
    tx.insert(chatSessions).values({
      id: chatSessionId,
      agentId: agent.id,
      type: 'execution',
      surfaceKind: 'imported_agent',
      surfaceRef: candidate.source,
      status: 'active',
      label: candidate.label,
      workspaceId,
      executionId,
      lastOutcomeEventAt: candidate.updatedAt,
      // Imported transcripts rank by when the work actually happened, not by
      // when the import ran — otherwise every sync would slam a year of old
      // sessions to the top of the rail.
      lastActivityAt: candidate.updatedAt,
      lastViewedAt: candidate.updatedAt,
      permissionMode: 'bypass',
      model: selection.model,
      effort: selection.effort,
      startedAt: candidate.startedAt,
      archivedAt: null,
      createdAt: candidate.startedAt,
      updatedAt: candidate.updatedAt,
    }).run();
    const ledger = tx.insert(externalSessionImports).values({
      id: ledgerId,
      chatSessionId,
      providerType: candidate.source,
      externalSessionId: candidate.externalSessionId,
      sourceKind: candidate.kind,
      sourcePath: candidate.kind === 'file' ? candidate.historySession.transcriptPath : null,
      sourceSize: candidate.kind === 'file' ? candidate.historySession.source.size : null,
      sourceModifiedAtNs: candidate.kind === 'file' ? candidate.historySession.source.modifiedAtNs : null,
      sourceUpdatedAt: candidate.updatedAt,
      syncOffset: 0,
      status: 'importing',
      lastScannedAt: new Date().toISOString(),
      createdAt: candidate.startedAt,
      updatedAt: candidate.updatedAt,
    }).returning().get();
    return { ledger, chatSessionId, executionId };
  });
}

function cleanupFailedInitialImport(
  chatSessionId: string,
  executionId: string,
  createdWorkspaceId: string | null,
): void {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(chatSessions).where(eq(chatSessions.id, chatSessionId)).run();
    tx.delete(executions).where(eq(executions.id, executionId)).run();
    if (!createdWorkspaceId) return;
    const hasOtherExecution = tx
      .select({ id: executions.id })
      .from(executions)
      .where(eq(executions.workspaceId, createdWorkspaceId))
      .get();
    if (!hasOtherExecution) {
      tx.delete(workspaces).where(eq(workspaces.id, createdWorkspaceId)).run();
    }
  });
}

function cleanupCreatedWorkspaceIfUnused(workspaceId: string): void {
  const db = getDb();
  const hasExecution = db
    .select({ id: executions.id })
    .from(executions)
    .where(eq(executions.workspaceId, workspaceId))
    .get();
  if (!hasExecution) db.delete(workspaces).where(eq(workspaces.id, workspaceId)).run();
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 500);
}

function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return null;
}

function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function markImportError(ledgerId: string, error: unknown): void {
  const now = new Date().toISOString();
  getDb().update(externalSessionImports).set({
    status: 'error',
    lastError: safeError(error),
    updatedAt: now,
  }).where(eq(externalSessionImports.id, ledgerId)).run();
}

interface HistoryWindowWriter {
  /**
   * Commit one window of normalized events plus the ledger position they leave
   * behind. Every window is one transaction, so an interrupted sync always ends
   * on a committed prefix rather than a torn one.
   */
  commit(pending: PendingHistoryEvent[], ledgerUpdate: UpdateExternalSessionImportInput): number;
  /** Whether any window has landed yet — the replace delete is still pending until one has. */
  readonly committed: boolean;
  readonly inserted: number;
}

function createHistoryWindowWriter(
  ledger: ExternalSessionImportRecord,
  options: { replace: boolean; sourceUpdatedAt: string },
): HistoryWindowWriter {
  const db = getDb();
  const executionId = db
    .select({ executionId: chatSessions.executionId })
    .from(chatSessions)
    .where(eq(chatSessions.id, ledger.chatSessionId))
    .get()?.executionId;
  // A replace drops the previously imported transcript, so it rides along with
  // the first window instead of running up front: a read that fails before it
  // produces anything must leave the existing transcript alone.
  let replacePending = options.replace;
  let lastExternalEventId = ledger.syncLastEventId;
  let inserted = 0;
  let committed = false;

  return {
    get committed() {
      return committed;
    },
    get inserted() {
      return inserted;
    },
    commit(pending, ledgerUpdate) {
      const now = new Date().toISOString();
      const replace = replacePending;
      if (replace) lastExternalEventId = null;
      lastExternalEventId = pending.at(-1)?.input.externalEventId ?? lastExternalEventId;
      const changes = db.transaction((tx) => {
        if (replace) {
          tx.delete(chatEvents).where(and(
            eq(chatEvents.sessionId, ledger.chatSessionId),
            isNotNull(chatEvents.externalEventId),
          )).run();
        }
        let count = 0;
        for (let index = 0; index < pending.length; index += EVENT_BATCH_SIZE) {
          const values = pending.slice(index, index + EVENT_BATCH_SIZE).map(({ input }) => ({
            ...input,
            id: input.id ?? uuidv7(),
            sessionId: ledger.chatSessionId,
            attachments: undefined,
            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? input.createdAt ?? now,
          }));
          if (values.length > 0) {
            count += tx.insert(chatEvents).values(values).onConflictDoNothing().run().changes;
          }
        }
        tx.update(externalSessionImports).set({
          ...ledgerUpdate,
          syncLastEventId: lastExternalEventId,
          status: 'current',
          lastScannedAt: now,
          lastSyncedAt: now,
          lastError: null,
          updatedAt: now,
        }).where(eq(externalSessionImports.id, ledger.id)).run();
        tx.update(chatSessions).set({
          lastOutcomeEventAt: options.sourceUpdatedAt,
          // Same clock `createImportSkeleton` sets on arrival: an imported chat
          // ranks by when the work happened, not by when the sync ran. Without
          // this the rail keeps a synced session pinned at its import-time
          // position while the transcript below it grows.
          lastActivityAt: options.sourceUpdatedAt,
          updatedAt: options.sourceUpdatedAt,
        }).where(eq(chatSessions.id, ledger.chatSessionId)).run();
        if (executionId) {
          tx.update(executions).set({ updatedAt: options.sourceUpdatedAt })
            .where(eq(executions.id, executionId))
            .run();
        }
        return count;
      });
      replacePending = false;
      committed = true;
      inserted += changes;
      return changes;
    },
  };
}

async function syncFileCandidate(
  candidate: FileCandidate,
  initialLedger: ExternalSessionImportRecord,
): Promise<number> {
  const before = await candidate.history.fingerprint(candidate.historySession, { sha256: true });
  const sourceMoved = Boolean(
    initialLedger.sourcePath
      && initialLedger.sourcePath !== candidate.historySession.transcriptPath,
  );
  const sourceShrank = before.size < initialLedger.syncOffset;
  const sameSizeChanged = before.size === initialLedger.syncOffset
    && Boolean(
      initialLedger.sourceContentSha256
        && before.sha256
        && initialLedger.sourceContentSha256 !== before.sha256,
    );
  const prefixChanged = !sourceMoved
    && initialLedger.sourceSize !== null
    && initialLedger.sourceContentSha256 !== null
    && before.size >= initialLedger.sourceSize
    && await sha256Prefix(
      candidate.historySession.transcriptPath,
      initialLedger.sourceSize,
    ) !== initialLedger.sourceContentSha256;
  const unverifiedPrefix = initialLedger.syncOffset > 0
    && initialLedger.sourceContentSha256 === null;
  const replace = sourceMoved
    || sourceShrank
    || sameSizeChanged
    || prefixChanged
    || unverifiedPrefix;
  const fromOffset = replace ? 0 : initialLedger.syncOffset;
  const transcriptPath = candidate.historySession.transcriptPath;
  const writer = createHistoryWindowWriter(initialLedger, {
    replace,
    sourceUpdatedAt: candidate.updatedAt,
  });
  const digest = createPrefixDigest(transcriptPath);
  let pending: PendingHistoryEvent[] = [];
  let stagedBytes = 0;
  let lastNextOffset = fromOffset;

  for await (const yielded of candidate.history.read(candidate.historySession, {
    fromOffset,
  })) {
    // Offsets are line-granular: one transcript line can normalize to several
    // events (a text block plus a tool call), and they all carry that line's
    // nextOffset. A window may only close where a new line starts, or the
    // ledger would claim an offset whose remaining events were never committed
    // and the resumed read would skip them.
    if (stagedBytes >= HISTORY_WINDOW_BYTES && yielded.lineStartOffset >= lastNextOffset) {
      writer.commit(pending, {
        sourcePath: transcriptPath,
        // The committed prefix, not the whole file: the next scan sees a
        // shorter source than the transcript and offers the rest as an update.
        sourceSize: lastNextOffset,
        sourceModifiedAtNs: before.modifiedAtNs,
        sourceContentSha256: await digest.at(lastNextOffset),
        sourceUpdatedAt: candidate.updatedAt,
        syncOffset: lastNextOffset,
        historyCheckpoint: null,
      });
      pending = [];
      stagedBytes = 0;
    }
    lastNextOffset = yielded.nextOffset;
    const input = historyEventInput(yielded.event, yielded.event.eventId, yielded.partIndex);
    if (!input) continue;
    pending.push({ input });
    stagedBytes += Buffer.byteLength(JSON.stringify(input), 'utf8');
  }

  const after = await candidate.history.fingerprint(candidate.historySession, { sha256: true });
  if (after.size !== before.size
    || after.modifiedAtNs !== before.modifiedAtNs
    || (before.sha256 !== undefined && after.sha256 !== before.sha256)) {
    throw codedError(
      'source_changed_during_read',
      'The provider transcript changed while it was being synchronized. Retry to continue.',
    );
  }
  writer.commit(pending, {
    sourcePath: transcriptPath,
    sourceSize: after.size,
    sourceModifiedAtNs: after.modifiedAtNs,
    sourceContentSha256: after.sha256 ?? null,
    sourceUpdatedAt: candidate.updatedAt,
    // Completion plus an unchanged strong fingerprint proves the reader
    // reached this stable EOF, including provider records that normalize to
    // no Flow event.
    syncOffset: Math.max(lastNextOffset, after.size),
    historyCheckpoint: null,
  });
  return writer.inserted;
}

function checkpointKey(checkpoint: HistoryCheckpoint): string {
  return `${checkpoint.kind} ${JSON.stringify(checkpoint.value ?? null)}`;
}

/**
 * Read provider-owned history, committing it in bounded windows. Returns the
 * final checkpoint so the caller can close out the sync.
 */
async function streamSavedHistory(
  candidate: ServiceCandidate,
  after: HistoryCheckpoint | undefined,
  mode: 'incremental' | 'bounded_full_resync',
  writer: HistoryWindowWriter,
): Promise<{ pending: PendingHistoryEvent[]; checkpoint: HistoryCheckpoint | null }> {
  let pending: PendingHistoryEvent[] = [];
  let checkpoint: HistoryCheckpoint | null = after ?? null;
  let stagedBytes = 0;
  for await (const yielded of candidate.history.read(candidate.historySession, {
    after,
    mode,
    ...candidate.runtime,
  })) {
    // One provider part can normalize to several events that share a
    // checkpoint, so only close a window once the checkpoint moves — a
    // checkpoint persisted mid-part would skip its siblings on resume.
    const staged = pending.at(-1)?.checkpoint;
    if (stagedBytes >= HISTORY_WINDOW_BYTES
      && staged
      && checkpointKey(staged) !== checkpointKey(yielded.checkpoint)) {
      writer.commit(pending, {
        sourceUpdatedAt: candidate.updatedAt,
        historyCheckpoint: staged,
      });
      pending = [];
      stagedBytes = 0;
    }
    checkpoint = yielded.checkpoint;
    const input = historyEventInput(yielded.event, yielded.eventId, yielded.partIndex);
    if (!input) continue;
    pending.push({ input, checkpoint: yielded.checkpoint });
    stagedBytes += Buffer.byteLength(JSON.stringify(input), 'utf8');
  }
  return { pending, checkpoint };
}

async function syncServiceCandidate(
  candidate: ServiceCandidate,
  initialLedger: ExternalSessionImportRecord,
): Promise<number> {
  let staged: { pending: PendingHistoryEvent[]; checkpoint: HistoryCheckpoint | null };
  const replace = !initialLedger.historyCheckpoint;
  let writer = createHistoryWindowWriter(initialLedger, {
    replace,
    sourceUpdatedAt: candidate.updatedAt,
  });
  try {
    staged = await streamSavedHistory(
      candidate,
      initialLedger.historyCheckpoint ?? undefined,
      replace ? 'bounded_full_resync' : 'incremental',
      writer,
    );
  } catch (error) {
    // A checkpoint the provider no longer recognizes means a full resync — but
    // only from a standing start. Once a window has landed, the ledger already
    // holds a newer checkpoint and the next sync resumes from it.
    if (errorCode(error) !== 'history_checkpoint_not_found' || writer.committed) throw error;
    writer = createHistoryWindowWriter(initialLedger, {
      replace: true,
      sourceUpdatedAt: candidate.updatedAt,
    });
    staged = await streamSavedHistory(candidate, undefined, 'bounded_full_resync', writer);
  }
  writer.commit(staged.pending, {
    sourceUpdatedAt: candidate.updatedAt,
    historyCheckpoint: staged.checkpoint,
  });
  return writer.inserted;
}

async function synchronizeCandidate(
  candidate: InternalCandidate,
  ledger: ExternalSessionImportRecord,
): Promise<number> {
  try {
    return candidate.kind === 'file'
      ? await syncFileCandidate(candidate, ledger)
      : await syncServiceCandidate(candidate, ledger);
  } catch (error) {
    markImportError(ledger.id, error);
    throw error;
  }
}

// ─── Keeping an imported chat current ─────────────────────────
//
// An imported chat has no executor subprocess and no
// `chat_sessions.external_session_id` — its transcript keeps growing in the
// terminal, and the import ledger is the only thing that knows where to read
// from. `reconcileSession` therefore routes imported chats here instead of
// through the executor's transcript reconcile, so the same four triggers that
// keep a live session honest (open a session, send a message, Resync, cold
// start) also keep an imported one current.

export interface ImportedSessionSyncResult {
  /** Events appended to `chat_events` by this call. */
  replayed: number;
  /**
   * Why nothing was replayed. `not_imported` means the chat has no ledger and
   * the caller should fall through to its normal path; `current` means the
   * source fingerprint already matched; `source_missing` means the provider no
   * longer has that transcript; `discovery_failed` means the provider could not
   * be enumerated, so absence proves nothing and the ledger is left alone.
   */
  skipped?: 'not_imported' | 'unknown_source' | 'current' | 'source_missing' | 'discovery_failed';
}

/**
 * Bring one ledger up to the candidate the scan just produced. Callers hold
 * the source lock; `ledger` must be re-read inside that lock so a queued
 * caller never syncs from a cursor another one already advanced past.
 */
async function syncLedger(
  ledger: ExternalSessionImportRecord,
  candidate: InternalCandidate | null,
  discoveryCompleted: boolean,
): Promise<ImportedSessionSyncResult> {
  const scannedAt = new Date().toISOString();
  if (!candidate) {
    // Only a completed scan can prove absence. A provider that failed to
    // enumerate leaves the ledger exactly as it was.
    if (discoveryCompleted) updateScanState(ledger, 'missing', scannedAt);
    return { replayed: 0, skipped: discoveryCompleted ? 'source_missing' : 'discovery_failed' };
  }
  const status = sourceStatus(candidate, ledger);
  updateScanState(ledger, status, scannedAt);
  if (status === 'current') return { replayed: 0, skipped: 'current' };

  publishReconcileStarted(ledger.chatSessionId);
  let inserted = 0;
  try {
    inserted = await synchronizeCandidate(candidate, ledger);
  } finally {
    // Always closes the client's reconcile frame, including on the throw —
    // otherwise an open transcript spins forever on a failed sync.
    publishReconcileDone(ledger.chatSessionId, inserted);
  }
  return { replayed: inserted };
}

/**
 * Pull any new provider history into one imported chat. Scans only that
 * chat's own provider (~200ms for a Claude history of a few hundred
 * transcripts) rather than the full three-source discovery the settings panel
 * runs, so this is cheap enough to sit on the session-open path.
 *
 * Throws when the sync itself fails — the ledger records the error too, but
 * the caller needs it to tell the user their Resync didn't work.
 */
export async function syncImportedSession(
  chatSessionId: string,
): Promise<ImportedSessionSyncResult> {
  const ledger = getExternalSessionImportForChat(chatSessionId);
  if (!ledger) return { replayed: 0, skipped: 'not_imported' };
  const source = ledger.providerType as ExternalAgentSource;
  if (!EXTERNAL_AGENT_SOURCES.includes(source)) {
    return { replayed: 0, skipped: 'unknown_source' };
  }

  const sourceIdentity = syncLockKey(source, ledger.externalSessionId);
  return withSourceSyncLock(sourceIdentity, async () => {
    const current = getExternalSessionImportForChat(chatSessionId);
    if (!current) return { replayed: 0, skipped: 'not_imported' };
    const { candidates, completed } = await discoverProvider(source);
    const key = sessionKey(source, current.externalSessionId);
    return syncLedger(current, candidates.find((c) => c.key === key) ?? null, completed);
  });
}

/**
 * Sync every imported chat that belongs to an active session, on one shared
 * discovery pass. Used by the cold-start sweep: coming back to the app after
 * working in the terminal should show the terminal's work, without having to
 * open each imported chat by hand.
 */
export async function syncAllImportedSessions(): Promise<{
  checked: number;
  synced: number;
  replayed: number;
  errors: number;
}> {
  const db = getDb();
  const ledgers = db
    .select({ ledger: externalSessionImports })
    .from(externalSessionImports)
    .innerJoin(chatSessions, eq(externalSessionImports.chatSessionId, chatSessions.id))
    .where(and(
      eq(chatSessions.status, 'active'),
      // Same rule `reconcileSession` applies: a chat that has since been sent
      // to from this app owns a live provider session, and that transcript is
      // its history now. The imported one stops being the source of truth.
      isNull(chatSessions.externalSessionId),
    ))
    .all()
    .map((row) => row.ledger);
  if (ledgers.length === 0) return { checked: 0, synced: 0, replayed: 0, errors: 0 };

  const { candidates, completed } = await discoverCandidatesInternal();
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  let checked = 0;
  let synced = 0;
  let replayed = 0;
  let errors = 0;

  for (const ledger of ledgers) {
    const source = ledger.providerType as ExternalAgentSource;
    if (!EXTERNAL_AGENT_SOURCES.includes(source)) continue;
    checked++;
    const sourceIdentity = syncLockKey(source, ledger.externalSessionId);
    try {
      const result = await withSourceSyncLock(sourceIdentity, async () => {
        const current = getExternalSessionImportForChat(ledger.chatSessionId);
        if (!current) return { replayed: 0, skipped: 'not_imported' as const };
        const key = sessionKey(source, current.externalSessionId);
        return syncLedger(current, byKey.get(key) ?? null, completed[source]);
      });
      if (result.replayed > 0) {
        synced++;
        replayed += result.replayed;
      }
    } catch (error) {
      errors++;
      console.error(`[imports] sweep sync failed for ${ledger.chatSessionId}:`, safeError(error));
    }
  }

  return { checked, synced, replayed, errors };
}

export interface ImportedTakeoverResult {
  /** The provider session this chat will now resume rather than fork. */
  externalSessionId: string;
  /** Where the agent will run. Always the workspace folder, never a worktree. */
  cwd: string;
}

/**
 * Flip an imported chat from mirror to live.
 *
 * Until this runs, an imported chat is a read-only mirror of a transcript some
 * other process owns. Sending into one used to spawn a brand-new provider
 * session, because the chat row carries no `external_session_id` and there was
 * nothing to hand `--resume`. The transcript pane kept showing the imported
 * history, so the chat displayed hundreds of turns while the agent answering
 * had none — with no signal to the user that those were two different
 * conversations.
 *
 * Taking over copies the ledger's provider session id onto the chat, which is
 * what makes the next dispatch resume the real thread, and pins the execution
 * to the workspace folder. Both are required: the provider resolves a session
 * id relative to the cwd it was started in, so resuming from anywhere else
 * silently finds nothing.
 *
 * Deliberately explicit rather than automatic on first send. Resuming a
 * session a terminal may still have open means two writers on one transcript,
 * and that is the user's call to make knowingly.
 */
export function takeOverImportedSession(chatSessionId: string): ImportedTakeoverResult {
  const session = getChatSessionWithExecution(chatSessionId);
  if (!session) throw new Error('Chat not found.');
  const ledger = getExternalSessionImportForChat(chatSessionId);
  if (!ledger) throw new Error('This chat was not imported.');
  if (ledger.status === 'missing') {
    throw new Error('The provider transcript this chat was imported from is no longer available.');
  }
  const workspace = session.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!workspace) throw new Error('This chat has no workspace to run in.');

  // Idempotent: a second call returns the same answer rather than re-pointing
  // a chat that is already live at a session it has since moved past.
  if (!session.externalSessionId) {
    updateChatSession(chatSessionId, {
      externalSessionId: ledger.externalSessionId,
      externalProviderType: ledger.providerType,
      // Let reconcile re-resolve from the live session's own cwd instead of
      // inheriting the import ledger's path and offset, which describe a
      // different file.
      externalTranscriptPath: null,
      externalSyncOffset: null,
      externalSyncLastEventId: null,
    });
  }
  if (session.executionId && session.worktreePath !== workspace.cwd) {
    updateExecution(session.executionId, {
      worktreePath: workspace.cwd,
      setupStartedAt: null,
      setupError: null,
    });
  }
  return {
    externalSessionId: session.externalSessionId ?? ledger.externalSessionId,
    cwd: workspace.cwd,
  };
}

function emptyImportResult(): ExternalAgentImportResult {
  return {
    importedSessions: 0,
    importedEvents: 0,
    syncedSessions: 0,
    syncedEvents: 0,
    createdWorkspaces: 0,
    skippedSessions: 0,
    failures: [],
    sessions: [],
  };
}

export async function importExternalAgentSessions(sessionKeys: string[]): Promise<ExternalAgentImportResult> {
  const uniqueKeys = [...new Set(sessionKeys)];
  if (uniqueKeys.length === 0) return emptyImportResult();
  if (uniqueKeys.length > MAX_IMPORT_SELECTION) {
    throw new Error(`Select at most ${MAX_IMPORT_SELECTION} chats per import.`);
  }
  const parsedKeys = uniqueKeys.map((key) => ({ key, parsed: parseSessionKey(key) }));
  const invalid = parsedKeys.find(({ parsed }) => !parsed);
  if (invalid) throw new Error(`Invalid session key: ${invalid.key}`);

  const { candidates, completed } = await discoverCandidatesInternal();
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const db = getDb();
  const result = emptyImportResult();
  const workspaceByCwd = new Map<string, { id: string; cwd: string }>();

  for (const { key, parsed } of parsedKeys) {
    if (!parsed) continue;
    const sourceIdentity = syncLockKey(parsed.source, parsed.externalSessionId);
    await withSourceSyncLock(sourceIdentity, async () => {
      const existing = db
        .select()
        .from(externalSessionImports)
        .where(and(
          eq(externalSessionImports.providerType, parsed.source),
          eq(externalSessionImports.externalSessionId, parsed.externalSessionId),
        ))
        .get();
      const candidate = byKey.get(key);
      if (!candidate) {
        if (existing && completed[parsed.source]) {
          updateScanState(existing, 'missing', new Date().toISOString());
          result.failures.push({ key, error: 'The imported provider history is no longer available.' });
        } else if (existing) {
          result.failures.push({ key, error: 'Provider history could not be enumerated. Try again.' });
        } else {
          result.failures.push({ key, error: 'The provider history was not found.' });
        }
        return;
      }
      if (existing) {
        try {
          const inserted = await synchronizeCandidate(candidate, existing);
          result.syncedSessions++;
          result.syncedEvents += inserted;
          result.sessions.push({ key, chatSessionId: existing.chatSessionId });
        } catch (error) {
          result.failures.push({ key, error: safeError(error) });
        }
        return;
      }

      let createdWorkspaceId: string | null = null;
      let createdSkeleton: ReturnType<typeof createImportSkeleton> | null = null;
      try {
        let target = workspaceByCwd.get(candidate.cwd);
        if (!target) {
          const workspace = await ensureImportWorkspace(candidate);
          target = { id: workspace.id, cwd: workspace.cwd };
          workspaceByCwd.set(candidate.cwd, target);
          if (workspace.created) {
            createdWorkspaceId = workspace.id;
            result.createdWorkspaces++;
          }
        }
        const workspaceId = target.id;
        const created = createImportSkeleton(candidate, workspaceId, target.cwd);
        createdSkeleton = created;
        const inserted = await synchronizeCandidate(candidate, created.ledger);
        result.importedSessions++;
        result.importedEvents += inserted;
        result.sessions.push({ key, chatSessionId: created.chatSessionId });
      } catch (error) {
        if (createdSkeleton) {
          cleanupFailedInitialImport(
            createdSkeleton.chatSessionId,
            createdSkeleton.executionId,
            createdWorkspaceId,
          );
        } else if (createdWorkspaceId) {
          cleanupCreatedWorkspaceIfUnused(createdWorkspaceId);
        }
        if (createdWorkspaceId) {
          workspaceByCwd.delete(candidate.cwd);
          result.createdWorkspaces--;
        }
        result.failures.push({ key, error: safeError(error) });
      }
    });
  }
  return result;
}

export async function refreshExternalAgentSessions(
  chatSessionIds: string[],
): Promise<ExternalAgentImportResult> {
  const uniqueIds = [...new Set(chatSessionIds)];
  if (uniqueIds.length === 0) return emptyImportResult();
  if (uniqueIds.length > MAX_IMPORT_SELECTION) {
    throw new Error(`Select at most ${MAX_IMPORT_SELECTION} chats per refresh.`);
  }
  const db = getDb();
  const ledgers = db.select().from(externalSessionImports).all()
    .filter((ledger) => uniqueIds.includes(ledger.chatSessionId));
  const keys = ledgers.map((ledger) => sessionKey(
    ledger.providerType as ExternalAgentSource,
    ledger.externalSessionId,
  ));
  const result = await importExternalAgentSessions(keys);
  for (const chatSessionId of uniqueIds) {
    if (!ledgers.some((ledger) => ledger.chatSessionId === chatSessionId)) {
      result.failures.push({ key: chatSessionId, error: 'The imported chat was not found.' });
    }
  }
  return result;
}
