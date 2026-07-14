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
import { and, eq, isNotNull } from 'drizzle-orm';
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
  getOrCreateDefaultExecutor,
  listWorkspaces,
} from '@/lib/db/queries';
import { parseStreamEvent } from '@/lib/executor/adapter';
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
const MAX_STAGED_HISTORY_BYTES = 25 * 1024 * 1024;
const EXTERNAL_AGENT_SOURCES = ['claude', 'codex', 'opencode'] as const satisfies readonly ExternalAgentSource[];
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
  nextOffset?: number;
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

async function sha256Prefix(filePath: string, byteLength: number): Promise<string> {
  const handle = await open(filePath, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  try {
    while (position < byteLength) {
      const length = Math.min(buffer.length, byteLength - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead === 0) {
        throw codedError('source_changed_during_read', 'The provider transcript became shorter while it was read.');
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
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
    `${ledger.providerType}\u0000${ledger.externalSessionId}`,
    ledger,
  ]));
  const discoveredSources = new Set<string>();

  for (const candidate of candidates) {
    const sourceIdentity = `${candidate.source}\u0000${candidate.externalSessionId}`;
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
    const sourceIdentity = `${source}\u0000${row.externalSessionId}`;
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

async function ensureImportWorkspace(candidate: InternalCandidate): Promise<{ id: string; created: boolean }> {
  const resolvedCwd = path.normalize(candidate.cwd);
  const existing = [
    ...listWorkspaces({ status: 'active' }),
    ...listWorkspaces({ status: 'archived' }),
  ].find((workspace) => path.normalize(workspace.cwd) === resolvedCwd);
  if (existing) return { id: existing.id, created: false };

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
  return { id: created.id, created: true };
}

function createImportSkeleton(
  candidate: InternalCandidate,
  workspaceId: string,
): { ledger: ExternalSessionImportRecord; chatSessionId: string; executionId: string } {
  const db = getDb();
  const harness = candidate.source === 'claude' ? 'claude_code' : candidate.source;
  const agent = getOrCreateDefaultExecutor(harness);
  const selection = explicitAgentSelection(candidate.source, {});
  const executionId = uuidv7();
  const chatSessionId = uuidv7();
  const ledgerId = uuidv7();
  const archivedAt = candidate.updatedAt;
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
      permissionMode: 'bypass',
      model: selection.model,
      effort: selection.effort,
      startedAt: candidate.startedAt,
      archivedAt,
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

function stageHistoryInput(
  pending: PendingHistoryEvent[],
  item: PendingHistoryEvent,
  stagedBytes: number,
): number {
  const nextBytes = stagedBytes + Buffer.byteLength(JSON.stringify(item.input), 'utf8');
  if (nextBytes > MAX_STAGED_HISTORY_BYTES) {
    throw codedError('history_resync_limit', 'Provider history exceeded the bounded synchronization limit.');
  }
  pending.push(item);
  return nextBytes;
}

function commitStagedEvents(
  ledger: ExternalSessionImportRecord,
  pending: PendingHistoryEvent[],
  options: {
    replace: boolean;
    ledgerUpdate: UpdateExternalSessionImportInput;
    sourceUpdatedAt: string;
  },
): number {
  const db = getDb();
  const now = new Date().toISOString();
  const executionId = db
    .select({ executionId: chatSessions.executionId })
    .from(chatSessions)
    .where(eq(chatSessions.id, ledger.chatSessionId))
    .get()?.executionId;
  return db.transaction((tx) => {
    if (options.replace) {
      tx.delete(chatEvents).where(and(
        eq(chatEvents.sessionId, ledger.chatSessionId),
        isNotNull(chatEvents.externalEventId),
      )).run();
    }
    let inserted = 0;
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
        inserted += tx.insert(chatEvents).values(values).onConflictDoNothing().run().changes;
      }
    }
    const lastExternalEventId = pending.at(-1)?.input.externalEventId
      ?? (options.replace ? null : ledger.syncLastEventId);
    tx.update(externalSessionImports).set({
      ...options.ledgerUpdate,
      syncLastEventId: lastExternalEventId,
      status: 'current',
      lastScannedAt: now,
      lastSyncedAt: now,
      lastError: null,
      updatedAt: now,
    }).where(eq(externalSessionImports.id, ledger.id)).run();
    tx.update(chatSessions).set({
      lastOutcomeEventAt: options.sourceUpdatedAt,
      updatedAt: options.sourceUpdatedAt,
    }).where(eq(chatSessions.id, ledger.chatSessionId)).run();
    if (executionId) {
      tx.update(executions).set({ updatedAt: options.sourceUpdatedAt })
        .where(eq(executions.id, executionId))
        .run();
    }
    return inserted;
  });
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
  const pending: PendingHistoryEvent[] = [];
  let stagedBytes = 0;
  let lastNextOffset = fromOffset;
  for await (const yielded of candidate.history.read(candidate.historySession, {
    fromOffset,
  })) {
    lastNextOffset = yielded.nextOffset;
    const input = historyEventInput(yielded.event, yielded.event.eventId, yielded.partIndex);
    if (!input) continue;
    stagedBytes = stageHistoryInput(
      pending,
      { input, nextOffset: yielded.nextOffset },
      stagedBytes,
    );
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
  return commitStagedEvents(initialLedger, pending, {
    replace,
    sourceUpdatedAt: candidate.updatedAt,
    ledgerUpdate: {
      sourcePath: candidate.historySession.transcriptPath,
      sourceSize: after.size,
      sourceModifiedAtNs: after.modifiedAtNs,
      sourceContentSha256: after.sha256 ?? null,
      sourceUpdatedAt: candidate.updatedAt,
      // Completion plus an unchanged strong fingerprint proves the reader
      // reached this stable EOF, including provider records that normalize to
      // no Flow event.
      syncOffset: Math.max(lastNextOffset, after.size),
      historyCheckpoint: null,
    },
  });
}

async function stageSavedHistory(
  candidate: ServiceCandidate,
  after: HistoryCheckpoint | undefined,
  mode: 'incremental' | 'bounded_full_resync',
): Promise<{ pending: PendingHistoryEvent[]; checkpoint: HistoryCheckpoint | null }> {
  const pending: PendingHistoryEvent[] = [];
  let checkpoint: HistoryCheckpoint | null = after ?? null;
  let stagedBytes = 0;
  for await (const yielded of candidate.history.read(candidate.historySession, {
    after,
    mode,
    ...candidate.runtime,
  })) {
    checkpoint = yielded.checkpoint;
    const input = historyEventInput(yielded.event, yielded.eventId, yielded.partIndex);
    if (!input) continue;
    stagedBytes = stageHistoryInput(
      pending,
      { input, checkpoint: yielded.checkpoint },
      stagedBytes,
    );
  }
  return { pending, checkpoint };
}

async function syncServiceCandidate(
  candidate: ServiceCandidate,
  initialLedger: ExternalSessionImportRecord,
): Promise<number> {
  let staged: { pending: PendingHistoryEvent[]; checkpoint: HistoryCheckpoint | null };
  let replace = !initialLedger.historyCheckpoint;
  try {
    staged = await stageSavedHistory(
      candidate,
      initialLedger.historyCheckpoint ?? undefined,
      replace ? 'bounded_full_resync' : 'incremental',
    );
  } catch (error) {
    if (errorCode(error) !== 'history_checkpoint_not_found') throw error;
    replace = true;
    staged = await stageSavedHistory(candidate, undefined, 'bounded_full_resync');
  }
  return commitStagedEvents(initialLedger, staged.pending, {
    replace,
    sourceUpdatedAt: candidate.updatedAt,
    ledgerUpdate: {
      sourceUpdatedAt: candidate.updatedAt,
      historyCheckpoint: staged.checkpoint,
    },
  });
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

function emptyImportResult(): ExternalAgentImportResult {
  return {
    importedSessions: 0,
    importedEvents: 0,
    syncedSessions: 0,
    syncedEvents: 0,
    createdWorkspaces: 0,
    skippedSessions: 0,
    failures: [],
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
  const workspaceByCwd = new Map<string, string>();

  for (const { key, parsed } of parsedKeys) {
    if (!parsed) continue;
    const sourceIdentity = `${parsed.source}\u0000${parsed.externalSessionId}`;
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
        } catch (error) {
          result.failures.push({ key, error: safeError(error) });
        }
        return;
      }

      let createdWorkspaceId: string | null = null;
      let createdSkeleton: ReturnType<typeof createImportSkeleton> | null = null;
      try {
        let workspaceId = workspaceByCwd.get(candidate.cwd);
        if (!workspaceId) {
          const workspace = await ensureImportWorkspace(candidate);
          workspaceId = workspace.id;
          workspaceByCwd.set(candidate.cwd, workspaceId);
          if (workspace.created) {
            createdWorkspaceId = workspace.id;
            result.createdWorkspaces++;
          }
        }
        const created = createImportSkeleton(candidate, workspaceId);
        createdSkeleton = created;
        const inserted = await synchronizeCandidate(candidate, created.ledger);
        result.importedSessions++;
        result.importedEvents += inserted;
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
