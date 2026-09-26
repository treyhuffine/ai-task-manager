/**
 * A harness's local session history, listed and read without a database
 * (docs/homes-build.md, P2.9): the half of the history import that runs on
 * the computer with the native files. The home runs it for its own, and a
 * connected computer's worker runs it for its own and answers the home's
 * `list_history` and `read_history` requests with it. Listing gives what a
 * person needs to choose a session, and reading gives one window of a
 * chosen transcript: nothing else of a computer's history leaves it.
 *
 * Moved out of `external-agents.ts`, which keeps the ledger, the chats and
 * the commits.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { constants as fsConstants, realpathSync, type BigIntStats } from 'node:fs';
import { lstat, open, realpath, stat, type FileHandle } from 'node:fs/promises';
import {
  getProvider,
  type LocalHistoryEvent,
  type LocalHistoryOps,
  type LocalHistorySession,
  type ProviderRuntimeContext,
  type SavedHistoryEvent,
  type SavedHistoryOps,
  type SavedHistorySession,
} from '@agentex/agent';
import type { CreateChatEventInput } from '@/db/types';
import { getAppRoot } from '@/lib/config/paths';
import { openCodeRuntimeContext } from '@/lib/harness/opencode';
import { runtimeContextForHarness } from '@/lib/harness/runtime';
import { parseStreamEvent } from '@/lib/runner/parse';
import type { ExternalAgentSessionCandidate, ExternalAgentSource } from './types';

export const MAX_EXTERNAL_SESSION_ID_LENGTH = 512;
export const EXTERNAL_AGENT_SOURCES = ['claude', 'codex', 'opencode'] as const satisfies readonly ExternalAgentSource[];

export interface CandidateBase extends ExternalAgentSessionCandidate {
  kind: 'file' | 'service';
}

export interface FileCandidate extends CandidateBase {
  kind: 'file';
  history: LocalHistoryOps;
  historySession: LocalHistorySession;
  /**
   * The real folder the transcript was found in, taken when it was
   * discovered. Every read checks it's still there (`pinTranscript`), so a
   * folder relinked since can't hand over a file nobody chose. Local-runtime
   * detail, never sent to a client.
   */
  realDir: string;
}

export interface ServiceCandidate extends CandidateBase {
  kind: 'service';
  history: SavedHistoryOps;
  historySession: SavedHistorySession;
  runtime: Pick<ProviderRuntimeContext, 'cwd' | 'env' | 'config'>;
}

export type InternalCandidate = FileCandidate | ServiceCandidate;

export function providerLabel(source: ExternalAgentSource): string {
  if (source === 'claude') return 'Claude';
  if (source === 'codex') return 'Codex';
  return 'OpenCode';
}

export function validExternalSessionId(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_EXTERNAL_SESSION_ID_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function sessionKey(source: ExternalAgentSource, externalSessionId: string): string {
  return `${source}:${Buffer.from(externalSessionId, 'utf8').toString('base64url')}`;
}

export function parseSessionKey(key: string): { source: ExternalAgentSource; externalSessionId: string } | null {
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

export function cleanLabel(value: string | null, fallback: string): string {
  const cleaned = value
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\[\[[^\]]+\]\]/g, ' ')
    .replace(/^[#>*_`\s-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > 120 ? `${cleaned.slice(0, 117).trimEnd()}...` : cleaned;
}

export function normalizeAbsoluteCwd(value: string): string | null {
  return path.isAbsolute(value) ? path.normalize(value) : null;
}

export async function pathIsDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

export interface PrefixDigest {
  /** sha256 of `[0, offset)`. Offsets must be requested in ascending order. */
  at(offset: number): Promise<string>;
}

/**
 * One transcript, opened once, for the length of a read (P2.7 to P2.9 review
 * fixes). The provider's parser opens the path on its own, so what it parsed
 * and what a window's hash certifies are the same bytes only if the path named
 * this one file, unchanged, from before the parse to after the hash. Every
 * hash is taken from this handle, never by opening the path again, and
 * `assertUnchanged` checks the rest: the path still names this file, and its
 * size and modification time are what they were when it was opened. A
 * transcript rewritten in place or replaced, even mid-window, is refused, and
 * nothing of that read is committed.
 *
 * It opens without following a link: a transcript replaced by a symlink is
 * refused rather than followed to a file nobody selected. And `realDir`, the
 * real folder the transcript was discovered in, must still be its folder, so
 * one moved or relinked out of that folder is refused too (P2.7 to P2.9
 * re-check: the parent is a link `O_NOFOLLOW` doesn't cover). An ordinary
 * atomic rewrite in place, in the same folder, is just a changed transcript.
 */
export interface PinnedTranscript {
  readonly size: number;
  readonly modifiedAtNs: string;
  /** A rolling sha256 over the pinned file: hash forward once, snapshot at each boundary. */
  digest(): PrefixDigest;
  /** Throws `source_changed_during_read` unless the path still names the pinned file, unchanged. */
  assertUnchanged(): Promise<void>;
  close(): Promise<void>;
}

const changed = (message = 'The transcript changed while it was being read. Try again.') =>
  codedError('source_changed_during_read', message);

export async function pinTranscript(filePath: string, opts: { realDir: string }): Promise<PinnedTranscript> {
  let handle: FileHandle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EMLINK') throw codedError('not_a_transcript', "That session's transcript is no longer a plain file where it was found.");
    if (code === 'ENOENT') throw codedError('source_missing', "That session's transcript is gone.");
    throw err;
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) throw codedError('not_a_transcript', "That session's transcript is no longer a plain file where it was found.");
    if ((await realpath(path.dirname(filePath))) !== opts.realDir) {
      throw codedError('not_a_transcript', "That session's transcript is no longer in the folder it was found in.");
    }
    return {
      size: Number(opened.size),
      modifiedAtNs: opened.mtimeNs.toString(),
      digest() {
        const hash = createHash('sha256');
        let hashedTo = 0;
        return {
          async at(offset: number): Promise<string> {
            if (offset < hashedTo) throw changed('The provider transcript rewound while it was being synchronized.');
            const buffer = Buffer.allocUnsafe(64 * 1024);
            while (hashedTo < offset) {
              const length = Math.min(buffer.length, offset - hashedTo);
              const { bytesRead } = await handle.read(buffer, 0, length, hashedTo);
              if (bytesRead === 0) throw changed('The provider transcript became shorter while it was read.');
              hash.update(buffer.subarray(0, bytesRead));
              hashedTo += bytesRead;
            }
            return hash.copy().digest('hex');
          },
        };
      },
      async assertUnchanged() {
        const now = await handle.stat({ bigint: true });
        let named: BigIntStats;
        try {
          named = await lstat(filePath, { bigint: true });
        } catch {
          throw changed();
        }
        if (now.size !== opened.size || now.mtimeNs !== opened.mtimeNs || named.dev !== opened.dev || named.ino !== opened.ino) {
          throw changed();
        }
      },
      close: () => handle.close(),
    };
  } catch (err) {
    await handle.close();
    throw err;
  }
}

export function baseCandidate(
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

export function fileCandidate(
  source: ExternalAgentSource,
  history: LocalHistoryOps,
  historySession: LocalHistorySession,
): FileCandidate | null {
  const candidate = baseCandidate(source, historySession);
  if (!candidate) return null;
  let realDir: string;
  try {
    realDir = realpathSync(path.dirname(historySession.transcriptPath));
  } catch {
    return null;
  }
  return { ...candidate, kind: 'file', history, historySession, realDir };
}

export function serviceCandidate(
  source: ExternalAgentSource,
  history: SavedHistoryOps,
  historySession: SavedHistorySession,
  runtime: Pick<ProviderRuntimeContext, 'cwd' | 'env' | 'config'>,
): ServiceCandidate | null {
  const candidate = baseCandidate(source, historySession);
  return candidate ? { ...candidate, kind: 'service', history, historySession, runtime } : null;
}

export async function mapLimited<T, U>(
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

export async function savedHistoryRuntime(
  source: ExternalAgentSource,
): Promise<Pick<ProviderRuntimeContext, 'cwd' | 'env' | 'config'>> {
  const runtime = source === 'opencode'
    ? await openCodeRuntimeContext()
    : await runtimeContextForHarness(source, { cwd: getAppRoot() });
  return { cwd: runtime.cwd, env: runtime.env, config: runtime.config };
}

export async function discoverProvider(source: ExternalAgentSource): Promise<{
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

export async function discoverCandidatesInternal(): Promise<{
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

export function historyEventInput(
  event: LocalHistoryEvent | SavedHistoryEvent,
  eventId: string,
  partIndex: number,
): CreateChatEventInput | null {
  // `parseStreamEvent` now sets messageId/parentToolCallId too, so those two
  // are redundant on the non-user path — but the user path below builds its
  // row by hand and has no other source for them. Kept in one place rather
  // than split across the two branches.
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

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 500);
}

export function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return null;
}

export function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

// ─── For the home, from a connected computer (P2.9) ──────────

/** A session as a connected computer lists it: enough to choose it, and nothing of its content or where it's stored. */
export interface ListedHistorySession {
  key: string;
  source: ExternalAgentSource;
  externalSessionId: string;
  label: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  branchName: string | null;
  /** Kept in a file this computer can read. OpenCode serves its history from a running process instead. */
  readable: boolean;
  /** The transcript's size, for a file: how far a reader must be to have all of it. */
  size: number | null;
}

export interface HistoryListing {
  sessions: ListedHistorySession[];
  available: Record<ExternalAgentSource, boolean>;
}

export function listedSession(candidate: InternalCandidate): ListedHistorySession {
  return {
    key: candidate.key,
    source: candidate.source,
    externalSessionId: candidate.externalSessionId,
    label: candidate.label,
    cwd: candidate.cwd,
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
    branchName: candidate.branchName,
    readable: candidate.kind === 'file',
    size: candidate.kind === 'file' ? candidate.historySession.source.size : null,
  };
}

/** What the reader already has: the size of the transcript it holds, and the hash of those bytes. */
export interface HistoryPrefix {
  size: number;
  sha256: string;
}

export interface HistoryWindow {
  /** The transcript no longer starts with what the reader has: this window starts over from the beginning. */
  replaced: boolean;
  events: CreateChatEventInput[];
  /** Where the next window starts. */
  nextOffset: number;
  /** The transcript was read to its end. */
  done: boolean;
  modifiedAtNs: string;
  /** sha256 of the transcript's first `nextOffset` bytes, for the reader's next `expect`. */
  prefixSha256: string;
}

/**
 * One window of a transcript: events from `fromOffset`, up to about
 * `maxBytes` of them, ending where a line ends (one line can become several
 * events, and a window mustn't split them). The reader's `expect` is checked
 * first: a transcript that no longer starts with those bytes (rewritten,
 * truncated, replaced) is read from the beginning instead, and says so. The
 * same checks the home's own sync makes.
 *
 * The events and the hash that certifies them come from one pinned file
 * (`pinTranscript`), checked unchanged after both, for every window, whether
 * or not it reached the end. A transcript being written to while a window is
 * read is read again, a few times, before giving up.
 */
export async function readHistoryWindow(
  candidate: FileCandidate,
  opts: { fromOffset: number; expect: HistoryPrefix | null; maxBytes: number },
): Promise<HistoryWindow> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await readPinnedWindow(candidate, opts);
    } catch (err) {
      if ((err as { code?: string }).code !== 'source_changed_during_read' || attempt >= WINDOW_ATTEMPTS) throw err;
    }
  }
}

const WINDOW_ATTEMPTS = 3;

async function readPinnedWindow(
  candidate: FileCandidate,
  opts: { fromOffset: number; expect: HistoryPrefix | null; maxBytes: number },
): Promise<HistoryWindow> {
  const pinned = await pinTranscript(candidate.historySession.transcriptPath, { realDir: candidate.realDir });
  try {
    let digest = pinned.digest();
    let fromOffset = opts.fromOffset;
    let replaced = false;
    if (fromOffset > 0) {
      const holds = opts.expect !== null
        && opts.expect.size === fromOffset
        && pinned.size >= opts.expect.size
        && (await digest.at(opts.expect.size)) === opts.expect.sha256;
      if (!holds) {
        fromOffset = 0;
        replaced = true;
        digest = pinned.digest();
      }
    }

    const events: CreateChatEventInput[] = [];
    let staged = 0;
    let nextOffset = fromOffset;
    let done = true;
    for await (const yielded of candidate.history.read(candidate.historySession, { fromOffset })) {
      if (staged >= opts.maxBytes && yielded.lineStartOffset >= nextOffset) {
        done = false;
        break;
      }
      nextOffset = yielded.nextOffset;
      const input = historyEventInput(yielded.event, yielded.event.eventId, yielded.partIndex);
      if (!input) continue;
      events.push(input);
      staged += Buffer.byteLength(JSON.stringify(input), 'utf8');
    }
    // Records that normalize to no event still count as read.
    if (done) nextOffset = Math.max(nextOffset, pinned.size);
    const prefixSha256 = await digest.at(nextOffset);
    // After the parse and the hash: both were of this file, as it was opened.
    await pinned.assertUnchanged();
    return { replaced, events, nextOffset, done, modifiedAtNs: pinned.modifiedAtNs, prefixSha256 };
  } finally {
    await pinned.close();
  }
}
