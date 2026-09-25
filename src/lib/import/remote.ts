/**
 * Terminal history from a connected computer (docs/homes-build.md, P2.9):
 * the home's half. It lists a computer's sessions through its worker,
 * imports the ones a person chooses, read-only, into the agent set up in
 * that folder there, and keeps each fresh from that computer while it's
 * connected.
 *
 * The native files never leave their computer. The worker lists sessions
 * without their content (`list_history`), and reads a chosen one a window
 * at a time from where the home left off (`read_history`), checking the
 * home's copy is still a prefix of it. The windows are committed through the
 * same writer as the home's own imports.
 */

import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ExternalSessionImportRecord } from '@/db/types';
import { getDb } from '@/lib/db';
import { chatSessions, executionPlacements, executions, externalSessionImports } from '@/lib/db/schema';
import {
  chatPlacement,
  getComputer,
  getExternalSessionImportBySource,
  getExternalSessionImportForChat,
  getWorkspace,
  listAgentSetups,
} from '@/lib/db/queries';
import { explicitHarnessSelection } from '@/lib/harness/options';
import { DEFAULT_PERMISSION_MODE } from '@/lib/permissions/modes';
import { WorkerUnavailableError, isComputerConnected, requestWorker } from '@/lib/workers/hub';
import {
  cleanupFailedInitialImport,
  createHistoryWindowWriter,
  emptyImportResult,
  markImportError,
  syncLockKey,
  withSourceSyncLock,
  type ImportedSessionSyncResult,
} from './external-agents';
import {
  EXTERNAL_AGENT_SOURCES,
  parseSessionKey,
  providerLabel,
  safeError,
  sessionKey,
  type HistoryListing,
  type HistoryWindow,
  type ListedHistorySession,
} from './history-source';
import type {
  ExternalAgentDiscovery,
  ExternalAgentImportResult,
  ExternalAgentImportStatus,
  ExternalAgentProjectCandidate,
  ExternalAgentSessionCandidate,
  ExternalAgentSource,
} from './types';

const MAX_SELECTION = 1_000;
/** Each read's size. The worker caps it too. */
const WINDOW_BYTES = 4 * 1024 * 1024;
/** Listing every harness's history on a computer, or reading a window, can take a while. */
const REQUEST_TIMEOUT_MS = 60_000;

function lockKey(computerId: string, source: ExternalAgentSource, externalSessionId: string): string {
  return `${computerId}:${syncLockKey(source, externalSessionId)}`;
}

function listOn(computerId: string): Promise<HistoryListing> {
  return requestWorker(computerId, 'list_history', null, REQUEST_TIMEOUT_MS) as Promise<HistoryListing>;
}

/**
 * The chats Ri runs on that computer, by session key: executions placed
 * there whose harness session is one of these. Selecting one opens it,
 * rather than importing a second copy.
 */
function riSessionsOn(computerId: string, listed: ListedHistorySession[]): Map<string, string> {
  const ids = [...new Set(listed.map((s) => s.externalSessionId))];
  const own = new Map<string, string>();
  if (ids.length === 0) return own;
  const rows = getDb()
    .select({ id: chatSessions.id, harness: chatSessions.harness, externalSessionId: chatSessions.externalSessionId, surfaceKind: chatSessions.surfaceKind })
    .from(chatSessions)
    .where(inArray(chatSessions.externalSessionId, ids))
    .all();
  for (const row of rows) {
    if (row.surfaceKind === 'imported_agent' || !row.externalSessionId) continue;
    if (!EXTERNAL_AGENT_SOURCES.includes(row.harness as ExternalAgentSource)) continue;
    if (chatPlacement(row.id)?.computerId !== computerId) continue;
    own.set(sessionKey(row.harness as ExternalAgentSource, row.externalSessionId), row.id);
  }
  return own;
}

/** The agents set up on that computer, by their folder there. */
function agentsByFolder(computerId: string): Map<string, { id: string; name: string }> {
  const agents = new Map<string, { id: string; name: string }>();
  for (const setup of listAgentSetups({ computerId })) {
    const workspace = getWorkspace(setup.workspaceId);
    if (!workspace || workspace.status !== 'active') continue;
    agents.set(path.normalize(setup.sourcePath), { id: workspace.id, name: workspace.name });
  }
  return agents;
}

function importsOn(computerId: string): Map<string, ExternalSessionImportRecord> {
  const rows = getDb().select().from(externalSessionImports).where(eq(externalSessionImports.computerId, computerId)).all();
  return new Map(rows.map((row) => [sessionKey(row.providerType as ExternalAgentSource, row.externalSessionId), row]));
}

/** As the home judges its own imports: current when it holds the whole transcript. */
function statusOf(listed: ListedHistorySession, ledger: ExternalSessionImportRecord): Exclude<ExternalAgentImportStatus, 'not_imported'> {
  if (ledger.status === 'importing' || ledger.status === 'error') return ledger.status;
  if (listed.size !== null) return ledger.syncOffset >= listed.size ? 'current' : 'changed';
  return ledger.sourceUpdatedAt && listed.updatedAt <= ledger.sourceUpdatedAt ? 'current' : 'changed';
}

/** A computer's sessions, grouped by folder, with what Ri already has of each. */
export async function discoverRemoteSessions(computerId: string): Promise<ExternalAgentDiscovery> {
  const computer = getComputer(computerId);
  if (!computer) throw new Error('That computer is not part of this home.');
  const listing = await listOn(computerId);
  const ledgers = importsOn(computerId);
  const own = riSessionsOn(computerId, listing.sessions);
  const agents = agentsByFolder(computerId);

  const byFolder = new Map<string, ExternalAgentSessionCandidate[]>();
  for (const listed of listing.sessions) {
    const ledger = ledgers.get(listed.key);
    const ours = own.get(listed.key);
    const agent = agents.get(path.normalize(listed.cwd));
    const note = ours
      ? 'Ri runs this session there.'
      : !listed.readable
        ? `${providerLabel(listed.source)} history on another computer can't be imported yet.`
        : !agent
          ? `Set this folder up as an agent on ${computer.name} to import its sessions.`
          : undefined;
    const candidate: ExternalAgentSessionCandidate = {
      key: listed.key,
      source: listed.source,
      externalSessionId: listed.externalSessionId,
      label: listed.label,
      cwd: listed.cwd,
      startedAt: listed.startedAt,
      updatedAt: listed.updatedAt,
      branchName: listed.branchName,
      imported: Boolean(ours || ledger),
      importStatus: ours ? 'current' : ledger ? statusOf(listed, ledger) : 'not_imported',
      ...(ours ?? ledger ? { chatSessionId: ours ?? ledger!.chatSessionId } : {}),
      importable: !ours && listed.readable && Boolean(agent),
      ...(note ? { note } : {}),
    };
    const list = byFolder.get(listed.cwd) ?? [];
    list.push(candidate);
    byFolder.set(listed.cwd, list);
  }

  const projects: ExternalAgentProjectCandidate[] = [...byFolder].map(([cwd, sessions]) => ({
    id: cwd,
    name: path.basename(cwd) || cwd,
    cwd,
    pathExists: true,
    sessions: sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    agent: agents.get(path.normalize(cwd)) ?? null,
  }));
  projects.sort((a, b) => (b.sessions[0]?.updatedAt ?? '').localeCompare(a.sessions[0]?.updatedAt ?? ''));
  const all = projects.flatMap((p) => p.sessions);
  const summary = (source: ExternalAgentSource) => ({
    available: listing.available[source] ?? false,
    found: all.filter((s) => s.source === source).length,
    imported: all.filter((s) => s.source === source && s.imported).length,
  });
  return {
    projects,
    sources: { claude: summary('claude'), codex: summary('codex'), opencode: summary('opencode') },
    scannedAt: new Date().toISOString(),
    computer: { id: computer.id, name: computer.name },
  };
}

/**
 * The imported chat, in the agent set up in that folder there, placed on
 * that computer: its execution's folder is there, so the home never looks
 * for it on its own disk. Read-only: nothing of it runs from here.
 */
function createRemoteImportSkeleton(
  computerId: string,
  listed: ListedHistorySession,
  agent: { id: string },
): { ledger: ExternalSessionImportRecord; chatSessionId: string; executionId: string } {
  const selection = explicitHarnessSelection(listed.source, {});
  const executionId = uuidv7();
  const chatSessionId = uuidv7();
  const now = new Date().toISOString();
  return getDb().transaction((tx) => {
    tx.insert(executions).values({
      id: executionId,
      workspaceId: agent.id,
      label: listed.label,
      branchName: listed.branchName,
      status: 'active',
      archivedAt: null,
      // The home's own path column stays the home's: the folder is on that computer.
      worktreePath: null,
      createdAt: listed.startedAt,
      updatedAt: listed.updatedAt,
    }).run();
    tx.insert(executionPlacements).values({
      id: uuidv7(),
      executionId,
      computerId,
      generation: 1,
      worktreePath: listed.cwd,
      startReason: 'adopted',
      createdAt: now,
      updatedAt: now,
    }).run();
    tx.insert(chatSessions).values({
      id: chatSessionId,
      harness: listed.source,
      type: 'execution',
      surfaceKind: 'imported_agent',
      surfaceRef: listed.source,
      status: 'active',
      label: listed.label,
      workspaceId: agent.id,
      executionId,
      lastOutcomeEventAt: listed.updatedAt,
      lastActivityAt: listed.updatedAt,
      lastViewedAt: listed.updatedAt,
      permissionMode: DEFAULT_PERMISSION_MODE,
      model: selection.model,
      effort: selection.effort,
      startedAt: listed.startedAt,
      archivedAt: null,
      createdAt: listed.startedAt,
      updatedAt: listed.updatedAt,
    }).run();
    const ledger = tx.insert(externalSessionImports).values({
      id: uuidv7(),
      chatSessionId,
      providerType: listed.source,
      externalSessionId: listed.externalSessionId,
      computerId,
      sourceKind: 'file',
      // Never a path on another computer.
      sourcePath: null,
      sourceSize: null,
      sourceModifiedAtNs: null,
      sourceUpdatedAt: listed.updatedAt,
      syncOffset: 0,
      status: 'importing',
      lastScannedAt: now,
      createdAt: listed.startedAt,
      updatedAt: listed.updatedAt,
    }).returning().get();
    return { ledger, chatSessionId, executionId };
  });
}

/**
 * Read the rest of a session from its computer, a window at a time, each
 * committed as it arrives: from where this import left off, or from the
 * beginning when the computer's transcript no longer starts with what the
 * home has. Returns the events added. Throws when a read fails, with the
 * windows already committed kept.
 */
async function readFromComputer(
  computerId: string,
  ledger: ExternalSessionImportRecord,
  updatedAt: string | null,
  progress: { committed: boolean },
): Promise<number> {
  const key = sessionKey(ledger.providerType as ExternalAgentSource, ledger.externalSessionId);
  let current = ledger;
  let inserted = 0;
  for (;;) {
    const fromOffset = current.syncOffset;
    const window = (await requestWorker(
      computerId,
      'read_history',
      {
        key,
        fromOffset,
        expect: fromOffset > 0 && current.sourceContentSha256 ? { size: fromOffset, sha256: current.sourceContentSha256 } : null,
        maxBytes: WINDOW_BYTES,
      },
      REQUEST_TIMEOUT_MS,
    )) as HistoryWindow;
    const lastEventAt = window.events.at(-1)?.createdAt ?? null;
    const sourceUpdatedAt = updatedAt ?? lastEventAt ?? current.sourceUpdatedAt ?? new Date().toISOString();
    const writer = createHistoryWindowWriter(current, { replace: window.replaced, sourceUpdatedAt });
    inserted += writer.commit(
      window.events.map((input) => ({ input })),
      {
        sourcePath: null,
        sourceSize: window.nextOffset,
        sourceModifiedAtNs: window.modifiedAtNs,
        sourceContentSha256: window.prefixSha256,
        sourceUpdatedAt,
        syncOffset: window.nextOffset,
        historyCheckpoint: null,
      },
    );
    progress.committed = true;
    current = getExternalSessionImportForChat(current.chatSessionId) ?? current;
    if (window.done) return inserted;
  }
}

/** Import the chosen sessions from a connected computer, or sync the ones already imported. */
export async function importRemoteSessions(computerId: string, sessionKeys: string[]): Promise<ExternalAgentImportResult> {
  const keys = [...new Set(sessionKeys)];
  if (keys.length > MAX_SELECTION) throw new Error(`Select at most ${MAX_SELECTION} chats per import.`);
  const computer = getComputer(computerId);
  if (!computer) throw new Error('That computer is not part of this home.');
  const result = emptyImportResult();
  const listing = await listOn(computerId);
  const listedByKey = new Map(listing.sessions.map((s) => [s.key, s]));
  const own = riSessionsOn(computerId, listing.sessions);
  const agents = agentsByFolder(computerId);

  for (const key of keys) {
    const parsed = parseSessionKey(key);
    if (!parsed) {
      result.failures.push({ key, error: 'Not a session key.' });
      continue;
    }
    await withSourceSyncLock(lockKey(computerId, parsed.source, parsed.externalSessionId), async () => {
      const ours = own.get(key);
      if (ours) {
        result.skippedSessions += 1;
        result.sessions.push({ key, chatSessionId: ours });
        return;
      }
      const listed = listedByKey.get(key) ?? null;
      const existing = getExternalSessionImportBySource(parsed.source, parsed.externalSessionId, computerId);
      if (existing) {
        try {
          result.syncedEvents += await readFromComputer(computerId, existing, listed?.updatedAt ?? null, { committed: false });
          result.syncedSessions += 1;
          result.sessions.push({ key, chatSessionId: existing.chatSessionId });
        } catch (err) {
          markImportError(existing.id, err);
          result.failures.push({ key, error: safeError(err) });
        }
        return;
      }
      if (!listed) {
        result.failures.push({ key, error: `That session is no longer on ${computer.name}.` });
        return;
      }
      const agent = agents.get(path.normalize(listed.cwd));
      if (!listed.readable || !agent) {
        result.failures.push({
          key,
          error: !listed.readable
            ? `${providerLabel(listed.source)} history on another computer can't be imported yet.`
            : `Set ${listed.cwd} up as an agent on ${computer.name} to import its sessions.`,
        });
        return;
      }
      const skeleton = createRemoteImportSkeleton(computerId, listed, agent);
      const progress = { committed: false };
      try {
        result.importedEvents += await readFromComputer(computerId, skeleton.ledger, listed.updatedAt, progress);
        result.importedSessions += 1;
        result.sessions.push({ key, chatSessionId: skeleton.chatSessionId });
      } catch (err) {
        // Nothing arrived: no chat is left behind. Something did: it's kept,
        // and the next sync picks up from there.
        if (progress.committed) markImportError(skeleton.ledger.id, err);
        else cleanupFailedInitialImport(skeleton.chatSessionId, skeleton.executionId, null);
        result.failures.push({ key, error: safeError(err) });
      }
    });
  }
  return result;
}

/**
 * Bring an imported chat up to date from its computer: what's new since the
 * last sync. A computer that isn't connected leaves the chat as it is, with
 * when it was last synced (`offline`).
 */
export async function syncRemoteImport(chatSessionId: string): Promise<ImportedSessionSyncResult> {
  const ledger = getExternalSessionImportForChat(chatSessionId);
  if (!ledger?.computerId) return { replayed: 0, skipped: 'not_imported' };
  const computerId = ledger.computerId;
  if (!isComputerConnected(computerId)) return { replayed: 0, skipped: 'offline' };
  const source = ledger.providerType as ExternalAgentSource;
  return withSourceSyncLock(lockKey(computerId, source, ledger.externalSessionId), async () => {
    const current = getExternalSessionImportForChat(chatSessionId);
    if (!current) return { replayed: 0, skipped: 'not_imported' };
    try {
      const replayed = await readFromComputer(computerId, current, null, { committed: false });
      return replayed > 0 ? { replayed } : { replayed, skipped: 'current' };
    } catch (err) {
      if (err instanceof WorkerUnavailableError) return { replayed: 0, skipped: 'offline' };
      markImportError(current.id, err);
      throw err;
    }
  });
}

/** How recent a sync can be for a reconnect to leave it alone. */
const RECONNECT_SYNC_AFTER_MS = 60_000;

/**
 * A computer that connects brings its imported sessions up to date, one at a
 * time in the background: what was worked on in its terminals while it was
 * away. One synced in the last minute is left alone, so a flaky connection
 * doesn't read the same history over and over.
 */
export async function syncRemoteImportsOn(computerId: string, now = Date.now()): Promise<number> {
  const rows = getDb()
    .select({ chatSessionId: externalSessionImports.chatSessionId, lastSyncedAt: externalSessionImports.lastSyncedAt })
    .from(externalSessionImports)
    .innerJoin(chatSessions, eq(externalSessionImports.chatSessionId, chatSessions.id))
    .where(and(eq(externalSessionImports.computerId, computerId), eq(chatSessions.status, 'active')))
    .all();
  let replayed = 0;
  for (const row of rows) {
    if (row.lastSyncedAt && now - Date.parse(row.lastSyncedAt) < RECONNECT_SYNC_AFTER_MS) continue;
    try {
      replayed += (await syncRemoteImport(row.chatSessionId)).replayed;
    } catch {
      // Recorded on the import. The next open or reconnect tries again.
    }
  }
  return replayed;
}
