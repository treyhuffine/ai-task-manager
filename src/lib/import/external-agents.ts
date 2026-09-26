import path from 'node:path';
import type { HistoryCheckpoint } from '@agentex/agent';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '@/lib/db';
import { DEFAULT_PERMISSION_MODE } from '@/lib/permissions/modes';
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
  getComputer,
  getExternalSessionImportForChat,
  getWorkspace,
  listWorkspaces,
  updateChatSession,
  updateExecution,
} from '@/lib/db/queries';
import {
  publishReconcileStarted,
  publishReconcileDone,
} from '@/lib/realtime/bus';
import { explicitHarnessSelection } from '@/lib/harness/options';
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
import {
  EXTERNAL_AGENT_SOURCES,
  codedError,
  discoverCandidatesInternal,
  discoverProvider,
  errorCode,
  historyEventInput,
  mapLimited,
  parseSessionKey,
  pathIsDirectory,
  providerLabel,
  safeError,
  sessionKey,
  pinTranscript,
  type FileCandidate,
  type PinnedTranscript,
  type InternalCandidate,
  type ServiceCandidate,
} from './history-source';

const MAX_IMPORT_SELECTION = 1_000;
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
// NUL, because it is the one byte a provider session id may never contain
// (`validExternalSessionId` rejects it), so `source + id` can't be ambiguous.
// Spelled this way rather than inline so the file stays free of raw control
// bytes that make grep treat it as binary.
const SYNC_LOCK_SEPARATOR = String.fromCharCode(0);
const sourceSyncTails = new Map<string, Promise<void>>();

export interface PendingHistoryEvent {
  input: CreateChatEventInput;
  /** Service sources only — the bookmark this event may be committed against. */
  checkpoint?: HistoryCheckpoint;
}

/**
 * Identity of one provider session: what the ledger lookup maps are keyed by,
 * and what every path that advances a ledger cursor locks on. Because the
 * settings-panel import, the per-session sync, and the cold-start sweep all
 * derive it the same way, none of them can replay a transcript window another
 * one is already committing.
 */
export function syncLockKey(source: ExternalAgentSource, externalSessionId: string): string {
  return `${source}${SYNC_LOCK_SEPARATOR}${externalSessionId}`;
}

export async function withSourceSyncLock<T>(sourceIdentity: string, action: () => Promise<T>): Promise<T> {
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
  // This computer's own imports. One from a connected computer is that
  // computer's (P2.9, `remote.ts`), and never missing from here.
  const ledgers = db.select().from(externalSessionImports).where(isNull(externalSessionImports.computerId)).all();
  const ledgerBySource = new Map(ledgers.map((ledger) => [
    syncLockKey(ledger.providerType as ExternalAgentSource, ledger.externalSessionId),
    ledger,
  ]));
  // App-spawned CLI chats bind their provider session id directly onto
  // chat_sessions (externalProviderType + externalSessionId) and never write an
  // external_session_imports ledger row — that ledger is only for historical
  // immutable imports. Without this second identity map, a session the app
  // started itself scans back off disk with imported=false and shows up in the
  // Import tab as if it were foreign. Keyed the same way as the ledger map so a
  // candidate resolves against either provenance; the unique index
  // `chat_sessions_external_provider_session_uq` keeps it one row per identity.
  const liveBoundBySource = new Map<string, string>();
  const liveBound = db
    .select({
      chatSessionId: chatSessions.id,
      providerType: chatSessions.externalProviderType,
      externalSessionId: chatSessions.externalSessionId,
    })
    .from(chatSessions)
    .where(and(
      isNotNull(chatSessions.externalProviderType),
      isNotNull(chatSessions.externalSessionId),
    ))
    .all();
  for (const row of liveBound) {
    const providerType = row.providerType as ExternalAgentSource;
    if (!row.externalSessionId || !EXTERNAL_AGENT_SOURCES.includes(providerType)) continue;
    liveBoundBySource.set(syncLockKey(providerType, row.externalSessionId), row.chatSessionId);
  }
  const discoveredSources = new Set<string>();

  for (const candidate of candidates) {
    const sourceIdentity = syncLockKey(candidate.source, candidate.externalSessionId);
    discoveredSources.add(sourceIdentity);
    const ledger = ledgerBySource.get(sourceIdentity);
    if (ledger) {
      const status = sourceStatus(candidate, ledger);
      candidate.imported = true;
      candidate.importStatus = status;
      candidate.chatSessionId = ledger.chatSessionId;
      updateScanState(ledger, status, scannedAt);
      continue;
    }
    // No import ledger, but the app may already own this exact session as a
    // live CLI chat it spawned. Treat that as already-present so it isn't
    // offered for import again. 'current' — a live session reconciles through
    // its own executor path, not the immutable-import sync.
    const liveChatSessionId = liveBoundBySource.get(sourceIdentity);
    if (liveChatSessionId) {
      candidate.imported = true;
      candidate.importStatus = 'current';
      candidate.chatSessionId = liveChatSessionId;
    }
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
    .where(isNull(externalSessionImports.computerId))
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
  const selection = explicitHarnessSelection(candidate.source, {});
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
      // The import source names the engine that ran the transcript.
      harness: candidate.source,
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
      permissionMode: DEFAULT_PERMISSION_MODE,
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

export function cleanupFailedInitialImport(
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

export function markImportError(ledgerId: string, error: unknown): void {
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

export function createHistoryWindowWriter(
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
  // Every check, window and hash below is of this one opened file, checked
  // unchanged before each commit, so a transcript replaced or rewritten
  // mid-read can't leave old events certified by a new file's hash (P2.7 to
  // P2.9 review fixes). What committed before a change stays valid: each
  // window was checked when it committed.
  const pinned = await pinTranscript(candidate.historySession.transcriptPath);
  try {
    return await syncPinned(candidate, initialLedger, pinned);
  } finally {
    await pinned.close();
  }
}

async function syncPinned(
  candidate: FileCandidate,
  initialLedger: ExternalSessionImportRecord,
  pinned: PinnedTranscript,
): Promise<number> {
  const size = pinned.size;
  const wholeSha256 = await pinned.digest().at(size);
  const sourceMoved = Boolean(
    initialLedger.sourcePath
      && initialLedger.sourcePath !== candidate.historySession.transcriptPath,
  );
  const sourceShrank = size < initialLedger.syncOffset;
  const sameSizeChanged = size === initialLedger.syncOffset
    && Boolean(initialLedger.sourceContentSha256 && initialLedger.sourceContentSha256 !== wholeSha256);
  const prefixChanged = !sourceMoved
    && initialLedger.sourceSize !== null
    && initialLedger.sourceContentSha256 !== null
    && size >= initialLedger.sourceSize
    && await pinned.digest().at(initialLedger.sourceSize) !== initialLedger.sourceContentSha256;
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
  const digest = pinned.digest();
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
      const sourceContentSha256 = await digest.at(lastNextOffset);
      await pinned.assertUnchanged();
      writer.commit(pending, {
        sourcePath: transcriptPath,
        // The committed prefix, not the whole file: the next scan sees a
        // shorter source than the transcript and offers the rest as an update.
        sourceSize: lastNextOffset,
        sourceModifiedAtNs: pinned.modifiedAtNs,
        sourceContentSha256,
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

  try {
    await pinned.assertUnchanged();
  } catch {
    throw codedError(
      'source_changed_during_read',
      'The provider transcript changed while it was being synchronized. Retry to continue.',
    );
  }
  writer.commit(pending, {
    sourcePath: transcriptPath,
    sourceSize: size,
    sourceModifiedAtNs: pinned.modifiedAtNs,
    sourceContentSha256: wholeSha256,
    sourceUpdatedAt: candidate.updatedAt,
    // Completion plus an unchanged pinned file proves the reader reached this
    // stable EOF, including provider records that normalize to no Flow event.
    syncOffset: Math.max(lastNextOffset, size),
    historyCheckpoint: null,
  });
  return writer.inserted;
}

function checkpointKey(checkpoint: HistoryCheckpoint): string {
  return `${checkpoint.kind}\u0000${JSON.stringify(checkpoint.value ?? null)}`;
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
  skipped?: 'not_imported' | 'unknown_source' | 'current' | 'source_missing' | 'discovery_failed' | 'offline';
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
  // A connected computer's session is read from that computer (P2.9).
  if (ledger.computerId) {
    const { syncRemoteImport } = await import('./remote');
    return syncRemoteImport(chatSessionId);
  }
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
      // This computer's own. A connected computer's are synced from there.
      isNull(externalSessionImports.computerId),
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
  // Read-only here: continuing it would move a session between computers,
  // which comes with P4 (docs/homes-build.md, P2.9).
  if (ledger.computerId) {
    const on = getComputer(ledger.computerId)?.name ?? 'another computer';
    throw new Error(`This session lives on ${on}. It can be read here, and continued in a terminal there.`);
  }
  if (ledger.status === 'missing') {
    throw new Error('The provider transcript this chat was imported from is no longer available.');
  }
  const workspace = session.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!workspace) throw new Error('This chat has no agent to run in.');

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

export function emptyImportResult(): ExternalAgentImportResult {
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
          isNull(externalSessionImports.computerId),
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

      // The app may already own this exact session as a live CLI chat it
      // spawned (bound on chat_sessions, no import ledger). Importing it again
      // would fork an immutable duplicate of a conversation that already syncs
      // through its own executor path. Report the owning chat and skip.
      const liveBoundChatSessionId = db
        .select({ id: chatSessions.id })
        .from(chatSessions)
        .where(and(
          eq(chatSessions.externalProviderType, parsed.source),
          eq(chatSessions.externalSessionId, parsed.externalSessionId),
        ))
        .get()?.id;
      if (liveBoundChatSessionId) {
        result.skippedSessions++;
        result.sessions.push({ key, chatSessionId: liveBoundChatSessionId });
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
  const ledgers = db.select().from(externalSessionImports).where(isNull(externalSessionImports.computerId)).all()
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
