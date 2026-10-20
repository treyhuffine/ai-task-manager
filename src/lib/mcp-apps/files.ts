import { createHash, randomUUID } from 'node:crypto';
import fs, { constants as fsConstants } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getAppRoot, getAttachmentsDir } from '@/lib/config/paths';
import { chatPlacement, getChatSessionWithExecution, getWorkspace, listWorkspaces } from '@/lib/db/queries';
import { hostedMcpDefinition } from '@/lib/integrations/hosted-mcp';
import type { McpServerEntry } from '@/lib/integrations/mcp-servers';
import { processState } from '@/lib/process-state';
import { agentDeviceFor } from '@/lib/setups/run-on';
import { sanitizeRelPath } from '@/lib/workspaces/read-file';
import { viewMetadata } from './metadata';
import type { View } from './store';

/**
 * Files opened through OpenAI's file entrypoint (docs/connected-mcp-apps.md,
 * "Files"). A view never sees a path. Ri gives it an opaque host URI for the
 * file (`ri-file:<random id>`) and answers `resources/read`,
 * `resources/subscribe` and `openai/resources/write` for that URI itself, so
 * an app reaches only the file the person opened in it.
 *
 * A handle names a file by where it lives, never by a path the browser sent:
 * a chat attachment by its stored name, an agent's file by the agent and a
 * path inside its folder, or, for `openai/files/open` from a server on this
 * computer, the path that server named.
 *
 * Each read, watch and save resolves the handle once with `realpath`, and the
 * file it lands on must be inside the folder it was opened from and outside
 * `.git` (in any letter case, as macOS folders ignore case). A symlink in the
 * folder is judged by where it lands. A save writes a new file beside the
 * original and renames it over, so a reader never sees half a save. Ri does
 * not guard against the folder changing mid-operation: whoever could do that
 * already has write access to the folder. Only an agent's own folder and a
 * chat's worktree are writable: an attachment is part of a message's history.
 */
export const HOST_FILE_SCHEME = 'ri-file:';
/** The largest file an app may open through Ri. */
export const MAX_HOST_FILE_BYTES = 32 * 1024 * 1024;
/**
 * The largest file an app may save through Ri. A save crosses the view's
 * relay as one message, which carries 12 MiB of binary as base64.
 */
export const MAX_HOST_WRITE_BYTES = 12 * 1024 * 1024;
const MAX_HANDLES = 256;
const MAX_WATCHES = 64;
const MAX_WATCHES_PER_VIEW = 8;
/** How long a change waits for more before it is reported, so one save is one notice. */
const WATCH_DEBOUNCE_MS = 150;
/** A long poll for a change returns after this long with nothing new. */
export const WATCH_WAIT_MS = 20_000;
/** The name a save writes before it replaces the file, beside it in the same folder. */
export const SAVE_SUFFIX = '.ri-save';

export type HostFileSource =
  | { kind: 'attachment'; fileName: string }
  | { kind: 'agent-folder'; workspaceId: string; path: string }
  /** A file in an execution's worktree, addressed through one of its chats. */
  | { kind: 'session-file'; sessionId: string; path: string }
  | { kind: 'local'; path: string; serverId: string };
interface HostFile { id: string; viewerId: string; source: HostFileSource; name: string }
interface Watch {
  view: View; uri: string; absolute: string; revision: number; etag: string;
  watcher: fs.FSWatcher; waiters: Set<() => void>; debounce?: ReturnType<typeof setTimeout>;
}

/** Handles, watches and per-file write queues are shared by every copy of this module in the process. */
const handles = () => processState('mcp-app-host-files', () => new Map<string, HostFile>());
const watches = () => processState('mcp-app-host-file-watches', () => new Map<string, Watch>());
const writes = () => processState('mcp-app-host-file-writes', () => new Map<string, Promise<unknown>>());

const MiB = 1024 * 1024;
const tooLarge = () => new Error(`Apps can open files up to ${MAX_HOST_FILE_BYTES / MiB} MiB.`);
const inside = (root: string, target: string) => target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
/** A stored attachment name: one segment, as `uploadAttachment` writes them. */
const ATTACHMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

export const etagOf = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('base64url')}`;
/** A file's etag, hashed as it streams so a large file is never held whole. */
async function etagOfFile(absolute: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(absolute)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest('base64url')}`;
}
/** A handle's file is gone, as opposed to refused. A watch reports it as `missing`. */
class MissingFile extends Error {}
/** A repository's internals, in any letter case: macOS folders are case-insensitive, so `.GIT` is `.git`. */
const isGitDir = (part: string) => part.toLowerCase() === '.git';
const inGit = (root: string, real: string) => path.relative(root, real).split(path.sep).some(isGitDir);
/** Saving is for an agent's folder and a chat's folder. Everything else an app opens stays read only. */
const SAVES_WHERE = 'Apps can save files only in an agent\'s folder or a chat\'s folder.';

/**
 * The message an app sees for a file system error: a fixed sentence for its
 * code, never the error's own text, which names this computer's paths. Ri
 * never hands a remote server this computer's paths (see `fileCallMeta`), so
 * an error doesn't either. Ri's own errors pass through unchanged.
 */
function publicFsError(error: unknown): Error {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (typeof code !== 'string' || !/^E[A-Z]+$/.test(code)) return error instanceof Error ? error : new Error('Ri could not use this file.');
  switch (code) {
    case 'ENOENT': case 'ENOTDIR': return new Error('This file no longer exists.');
    case 'EACCES': case 'EPERM': return new Error('Ri does not have permission to use this file.');
    case 'EISDIR': return new Error('Only regular files open in apps.');
    case 'ENOSPC': case 'EDQUOT': return new Error('The disk is full, so the file was not saved.');
    case 'EROFS': return new Error('This file is on a read-only disk.');
    case 'EFBIG': return tooLarge();
    case 'EMFILE': case 'ENFILE': case 'EBUSY': case 'ETXTBSY': case 'EAGAIN': return new Error('This file is busy. Try again.');
    default: return new Error('Ri could not use this file.');
  }
}
/** Run a file operation for an app, so no raw file system error reaches it. */
async function forApp<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { throw publicFsError(error); }
}

/** Whether `uri` names a file Ri opened for a view, rather than one of the server's resources. */
export function isHostResource(uri: string): boolean {
  return uri.startsWith(HOST_FILE_SCHEME);
}
const uriOf = (file: HostFile) => `${HOST_FILE_SCHEME}${file.id}`;

/**
 * Whether a server runs on this computer: a catalog command Ri starts itself,
 * or a URL on the loopback interface. Only then does a path mean the same
 * file to it as to Ri (OpenAI's spec: a path "on the execution host").
 */
export function serverRunsHere(entry: Pick<McpServerEntry, 'url' | 'providerId'> & Partial<McpServerEntry>): boolean {
  try { if (entry.providerId && hostedMcpDefinition(entry as McpServerEntry)?.localCommand) return true; } catch { return false; }
  let host: string;
  try { host = new URL(entry.url).hostname.toLowerCase(); } catch { return false; }
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
}

/** Handles are kept by count: the oldest unused one goes first. */
function remember(viewerId: string, source: HostFileSource, name: string): { handle: string; name: string } {
  // The same file opened again by the same person keeps its handle, so its URI is stable.
  const same = [...handles().values()].find(file => file.viewerId === viewerId && JSON.stringify(file.source) === JSON.stringify(source));
  if (same) { handles().delete(same.id); handles().set(same.id, same); return { handle: same.id, name: same.name }; }
  if (handles().size >= MAX_HANDLES) handles().delete(handles().keys().next().value!);
  const file: HostFile = { id: randomUUID(), viewerId, source, name };
  handles().set(file.id, file);
  return { handle: file.id, name };
}

/**
 * Where a handle's file is now: resolved once with `realpath` and checked
 * against where it was opened. `readOnly` says why it may not be saved, when
 * it may not.
 */
async function resolveHostFile(source: HostFileSource): Promise<{ absolute: string; readOnly?: string }> {
  if (source.kind === 'attachment') {
    if (!ATTACHMENT_NAME.test(source.fileName)) throw new Error('This attachment name is not valid.');
    const root = await fsp.realpath(getAttachmentsDir()).catch(() => { throw new MissingFile('This attachment no longer exists.'); });
    return { absolute: await containedFile(root, source.fileName, 'This attachment no longer exists.'), readOnly: `Attachments are read only. ${SAVES_WHERE}` };
  }
  if (source.kind === 'agent-folder') {
    const workspace = getWorkspace(source.workspaceId);
    if (!workspace) throw new Error('This agent no longer exists.');
    if (agentDeviceFor(source.workspaceId)) throw new Error('This agent\'s folder is on another device, so apps can\'t open its files here.');
    const relative = sanitizeRelPath(source.path);
    if (!relative) throw new Error('This path is not inside the agent\'s folder.');
    const root = await fsp.realpath(workspace.cwd).catch(() => { throw new MissingFile('The agent\'s folder does not exist.'); });
    const absolute = await containedFile(root, relative, 'This file no longer exists in the agent\'s folder.');
    return { absolute, ...(workspace.status === 'archived' ? { readOnly: 'This agent is archived, so its files are read only.' } : {}) };
  }
  if (source.kind === 'session-file') {
    // The same rules as the execution's own file routes (`openSessionWorktree`): a worktree on
    // this computer, a path inside it, never `.git`.
    const session = getChatSessionWithExecution(source.sessionId);
    if (!session) throw new Error('This chat no longer exists.');
    const placement = chatPlacement(source.sessionId);
    if (placement && !placement.isHome) throw new Error('This chat\'s files are on another device, so apps can\'t open them here.');
    if (!session.worktreePath) throw new Error('This chat has no folder.');
    const relative = sanitizeRelPath(source.path);
    if (!relative) throw new Error('This path is not inside the chat\'s folder.');
    const root = await fsp.realpath(session.worktreePath).catch(() => { throw new MissingFile('The chat\'s folder does not exist.'); });
    const absolute = await containedFile(root, relative, 'This file no longer exists in the chat\'s folder.');
    return { absolute, ...(session.status === 'archived' ? { readOnly: 'This chat is archived, so its files are read only.' } : {}) };
  }
  if (!path.isAbsolute(source.path)) throw new Error('Files open by absolute path.');
  // A file a server on this computer named: wherever its path lands now, never Ri's own files or a repository's internals.
  const real = await regularFile(source.path, 'This file no longer exists.');
  await localFileAllowed(real);
  return { absolute: real, readOnly: `This file is read only here. ${SAVES_WHERE}` };
}
/**
 * Whether a server on this computer may have Ri open a real path: never Ri's
 * own home (attachments come in as attachments, not paths) and never inside
 * an agent's `.git`.
 */
async function localFileAllowed(real: string): Promise<void> {
  const home = await fsp.realpath(getAppRoot()).catch(() => getAppRoot());
  if (inside(home, real)) throw new Error('Apps cannot open Ri\'s own files.');
  for (const workspace of listWorkspaces()) {
    if (agentDeviceFor(workspace.id)) continue;
    const root = await fsp.realpath(workspace.cwd).catch(() => null);
    if (root && inside(root, real) && inGit(root, real)) throw new Error('Apps cannot open files inside .git.');
  }
}
/**
 * The real path of a regular file inside `root` (itself a real path), never
 * in `.git`. The path is checked as written, then resolved once with
 * `realpath` and checked again where it lands, so a symlink is judged by its
 * target: one leading out of the folder or into `.git` is refused.
 */
async function containedFile(root: string, relative: string, missing: string): Promise<string> {
  const parts = relative.split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || isGitDir(part))) throw new Error('This path is not inside the folder it was opened from.');
  const real = await regularFile(path.join(root, relative), missing);
  if (real === root || !inside(root, real)) throw new Error('This file is outside the folder it was opened from.');
  if (inGit(root, real)) throw new Error('Apps cannot open files inside .git.');
  return real;
}
/** The real path of a regular file. */
async function regularFile(candidate: string, missing: string): Promise<string> {
  let real: string;
  try { real = await fsp.realpath(candidate); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new MissingFile(missing); throw error; }
  const stat = await fsp.stat(real);
  if (!stat.isFile()) throw new Error('Only regular files open in apps.');
  return real;
}
/** Whether a save could replace this file: the file is writable, and so is its folder, where the new file is made. */
async function canSave(absolute: string): Promise<boolean> {
  try {
    await fsp.access(absolute, fsConstants.W_OK);
    await fsp.access(path.dirname(absolute), fsConstants.W_OK);
    return true;
  } catch { return false; }
}
/**
 * Replace a file with `bytes`: a new file beside it (created exclusively,
 * given the original's mode), written and synced, then renamed over it. A
 * reader sees the old file or the new one, never part of either, and a
 * failed save leaves the original as it was.
 */
async function replaceFile(absolute: string, bytes: Buffer, mode: number): Promise<void> {
  const temporary = path.join(path.dirname(absolute), `.${randomUUID()}${SAVE_SUFFIX}`);
  const handle = await fsp.open(temporary, 'wx', 0o600);
  let renamed = false;
  try {
    await handle.chmod(mode & 0o7777);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await fsp.rename(temporary, absolute);
    renamed = true;
  } finally {
    if (!renamed) {
      await handle.close().catch(() => {});
      await fsp.unlink(temporary).catch(() => {});
    }
  }
}

/** A handle for a chat attachment. Any signed-in viewer can already download one. */
export async function attachmentHandle(viewerId: string, fileName: string, originalName?: string) {
  const source: HostFileSource = { kind: 'attachment', fileName };
  await forApp(() => resolveHostFile(source));
  return remember(viewerId, source, displayName(originalName) ?? fileName);
}
/** A handle for a file in an agent's own folder, by the agent and a path inside it. */
export async function agentFileHandle(viewerId: string, workspaceId: string, relativePath: string) {
  const source: HostFileSource = { kind: 'agent-folder', workspaceId, path: sanitizeRelPath(relativePath) ?? relativePath };
  await forApp(() => resolveHostFile(source));
  return remember(viewerId, source, path.basename(source.path));
}
/** A handle for a file in an execution's worktree, by one of its chats and a path inside it. */
export async function sessionFileHandle(viewerId: string, sessionId: string, relativePath: string) {
  const source: HostFileSource = { kind: 'session-file', sessionId, path: sanitizeRelPath(relativePath) ?? relativePath };
  await forApp(() => resolveHostFile(source));
  return remember(viewerId, source, path.basename(source.path));
}
const displayName = (name?: string) => name && name.length <= 255 && !/[\\/\0]/.test(name) ? name : undefined;

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/** The `FileInput` a file entrypoint receives (OpenAI's spec), and the capture's record of the file. */
export async function fileLaunchInput(request: { viewerId: string; serverId: string; chatId?: string; extensions: string[]; handle?: string }): Promise<{ input: Record<string, unknown>; file: { handle: string; name: string } }> {
  const file = request.handle ? handles().get(request.handle) : undefined;
  if (!file || file.viewerId !== request.viewerId) throw new Error('This file is no longer open here. Choose it again.');
  // A file a server named by path opens only in that server's own viewer.
  if (file.source.kind === 'local' && file.source.serverId !== request.serverId) throw new Error('This file can open only in the app that named it.');
  if (!request.extensions.includes(extensionOf(file.name))) throw new Error('This app does not open this kind of file.');
  await forApp(() => resolveHostFile(file.source));
  return { input: { file: { name: file.name, resourceUri: uriOf(file) } }, file: { handle: file.id, name: file.name } };
}

/** The file a view opened, when `uri` names it. A view reads, watches and writes only its own file. */
function viewFile(view: View, uri: string): HostFile {
  const id = uri.slice(HOST_FILE_SCHEME.length);
  const file = handles().get(id);
  if (view.capture.kind !== 'file' || view.capture.file?.handle !== id || !file || file.viewerId !== view.viewerId)
    throw new Error('This view can read only the file it opened.');
  return file;
}

/** A host resource's content, as `resources/read` returns it, with OpenAI's `openai/resource` metadata (`etag`, `writable`). */
export interface HostResourceContent { uri: string; mimeType?: string; text?: string; blob?: string; _meta?: Record<string, unknown> }

/**
 * `resources/read` for the opened file. `_meta["openai/resource"].representation`
 * picks text or a base64 blob. Without one, valid UTF-8 comes back as text
 * and anything else as a blob, which OpenAI's spec has an app handle either way.
 */
export async function readHostResource(view: View, uri: string, meta?: Record<string, unknown>): Promise<{ contents: HostResourceContent[] }> {
  const file = viewFile(view, uri);
  const { bytes, writable } = await forApp(async () => {
    const { absolute, readOnly } = await resolveHostFile(file.source);
    if ((await fsp.stat(absolute)).size > MAX_HOST_FILE_BYTES) throw tooLarge();
    const bytes = await fsp.readFile(absolute);
    if (bytes.length > MAX_HOST_FILE_BYTES) throw tooLarge();
    // `writable` is a promise the save will keep: a file or folder the person made read only is not offered.
    return { bytes, writable: !readOnly && await canSave(absolute) };
  });
  const representation = (meta?.['openai/resource'] as { representation?: unknown } | undefined)?.representation;
  let text: string | undefined;
  if (representation === 'text') text = bytes.toString('utf8');
  else if (representation !== 'blob') { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* Not UTF-8, so a blob. */ } }
  return { contents: [{ uri, mimeType: mimeOf(file.name), ...(text !== undefined ? { text } : { blob: bytes.toString('base64') }),
    _meta: { 'openai/resource': { etag: etagOf(bytes), writable } } }] };
}

/** The media type an app sees for a file, from its extension. */
export function mimeOf(name: string): string {
  return ({
    '.stl': 'model/stl', '.3mf': 'model/3mf', '.step': 'model/step', '.stp': 'model/step', '.obj': 'model/obj', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary',
    '.ipynb': 'application/x-ipynb+json', '.json': 'application/json', '.csv': 'text/csv', '.md': 'text/markdown', '.txt': 'text/plain',
    '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
  } as Record<string, string>)[extensionOf(name)] ?? 'application/octet-stream';
}

// ── Subscriptions ──────────────────────────────────────────────

const watchKey = (view: View, uri: string) => `${view.id}\n${uri}`;
/** The etag of what a handle names now. `missing` when it is gone. */
async function currentEtag(source: HostFileSource) {
  let absolute: string;
  try { ({ absolute } = await resolveHostFile(source)); }
  catch (error) { if (error instanceof MissingFile || (error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw error; }
  return etagOfFile(absolute);
}
function closeWatch(key: string) {
  const watch = watches().get(key);
  if (!watch) return;
  watches().delete(key);
  watch.watcher.close();
  clearTimeout(watch.debounce);
  for (const wake of watch.waiters) wake();
}

/**
 * `resources/subscribe`. Ri watches the file's folder, so a save that
 * replaces the file is still seen, and reports a change only when the
 * content differs. The watch ends when the view closes (`closeHostWatches`)
 * or on unsubscribe.
 */
export async function subscribeHostResource(view: View, uri: string): Promise<{ revision: number }> {
  const file = viewFile(view, uri);
  const key = watchKey(view, uri);
  const existing = watches().get(key);
  if (existing) return { revision: existing.revision };
  if (watches().size >= MAX_WATCHES || [...watches().values()].filter(watch => watch.view === view).length >= MAX_WATCHES_PER_VIEW)
    throw new Error('Too many files are being watched. Close another app view first.');
  const { absolute, etag } = await forApp(async () => ({ ...await resolveHostFile(file.source), etag: await currentEtag(file.source) }));
  // The view may have closed, or subscribed again, while this looked: start no watch nothing will end.
  if (view.closed) return { revision: 0 };
  const raced = watches().get(key);
  if (raced) return { revision: raced.revision };
  const folder = path.dirname(absolute), base = path.basename(absolute);
  const changed = (_event: string, name: string | null) => {
    if (name !== null && name !== base) return;
    clearTimeout(watch.debounce);
    watch.debounce = setTimeout(() => void (async () => {
      if (view.closed) { closeWatch(key); return; }
      const etag = await currentEtag(file.source).catch(() => watch.etag);
      if (etag === watch.etag || watches().get(key) !== watch) return;
      watch.etag = etag; watch.revision++;
      for (const wake of watch.waiters) wake();
    })(), WATCH_DEBOUNCE_MS);
  };
  // A watch that can't start (no permission, too many open files) says so in the app's terms, never with the folder's path.
  let watcher: fs.FSWatcher;
  try { watcher = fs.watch(folder, { persistent: false }, changed); }
  catch (error) { throw publicFsError(error); }
  const watch: Watch = { view, uri, absolute, revision: 0, etag, waiters: new Set(), watcher };
  watch.watcher.on('error', () => closeWatch(key));
  watches().set(key, watch);
  return { revision: 0 };
}
/** End every watch a view holds, when the view closes. A waiting poll wakes with `watching: false`. */
export function closeHostWatches(view: View) {
  for (const [key, watch] of watches()) if (watch.view === view) closeWatch(key);
}
export function unsubscribeHostResource(view: View, uri: string) {
  viewFile(view, uri);
  closeWatch(watchKey(view, uri));
}
/**
 * The browser's long poll for `notifications/resources/updated`: resolves as
 * soon as the file changes past `revision`, or after `WATCH_WAIT_MS` with the
 * same revision. `watching: false` means the watch ended.
 */
export async function waitHostResource(view: View, uri: string, revision: number, signal?: AbortSignal): Promise<{ revision: number; watching: boolean }> {
  viewFile(view, uri);
  const key = watchKey(view, uri);
  const watch = watches().get(key);
  if (!watch || view.closed) return { revision, watching: false };
  if (watch.revision > revision) return { revision: watch.revision, watching: true };
  await new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); watch.waiters.delete(done); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, WATCH_WAIT_MS);
    watch.waiters.add(done);
    signal?.addEventListener('abort', done, { once: true });
  });
  return { revision: watch.revision, watching: watches().get(key) === watch };
}

// ── Writes ─────────────────────────────────────────────────────

export type ResourceWrite = { uri: string; ifMatch?: string } & ({ text: string; blob?: never } | { blob: string; text?: never });
export type ResourceWriteResult = { outcome: 'saved' | 'conflict'; etag: string } | { outcome: 'too-large'; maxBytes: number };
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * `openai/resources/write`: only the opened file, only when it read as
 * writable, compared against `ifMatch` when given, up to
 * `MAX_HOST_WRITE_BYTES`. The save replaces the file atomically
 * (`replaceFile`), keeping its mode. Writes to one file run one at a time.
 */
export async function writeHostResource(view: View, request: ResourceWrite): Promise<ResourceWriteResult> {
  const file = viewFile(view, request.uri);
  const { absolute, readOnly } = await forApp(() => resolveHostFile(file.source));
  if (readOnly) throw new Error(readOnly);
  if (request.blob !== undefined && !BASE64.test(request.blob)) throw new Error('The file contents are not valid base64.');
  const bytes = request.text !== undefined ? Buffer.from(request.text, 'utf8') : Buffer.from(request.blob!, 'base64');
  if (bytes.length > MAX_HOST_WRITE_BYTES) return { outcome: 'too-large', maxBytes: MAX_HOST_WRITE_BYTES };
  const previous = writes().get(absolute) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => forApp(async (): Promise<ResourceWriteResult> => {
    // Resolve again inside the queue: the file may have moved while this write waited.
    const current = await resolveHostFile(file.source);
    if (current.readOnly) throw new Error(current.readOnly);
    try { await fsp.access(current.absolute, fsConstants.W_OK); }
    catch { throw new Error('This file is read only.'); }
    const etag = await etagOfFile(current.absolute);
    if (request.ifMatch !== undefined && request.ifMatch !== etag) return { outcome: 'conflict', etag };
    await replaceFile(current.absolute, bytes, (await fsp.stat(current.absolute)).mode);
    const saved = etagOf(bytes);
    // The writer already knows its own save. Every other view watching this file hears about it.
    const own = watches().get(watchKey(view, request.uri));
    if (own) own.etag = saved;
    return { outcome: 'saved', etag: saved };
  }));
  writes().set(absolute, run);
  try { return await run; }
  finally { if (writes().get(absolute) === run) writes().delete(absolute); }
}

// ── Tool calls and openai/files/open ────────────────────────────

/**
 * OpenAI's spec amends a file view's tool calls with the file's absolute path
 * (`_meta["openai/resource"].path`). Ri adds it only for a server on this
 * computer: a remote server's filesystem is not this one, so a path would
 * mean nothing to it and would tell it about this computer's folders.
 */
export async function fileCallMeta(view: View, entry: Pick<McpServerEntry, 'url' | 'providerId'> & Partial<McpServerEntry>): Promise<Record<string, unknown> | undefined> {
  if (view.capture.kind !== 'file' || !view.capture.file || !serverRunsHere(entry)) return undefined;
  const file = handles().get(view.capture.file.handle);
  if (!file || file.viewerId !== view.viewerId) return undefined;
  const { absolute } = await forApp(() => resolveHostFile(file.source));
  return { 'openai/resource': { path: absolute } };
}

/** Where `openai/files/open` shows a file: in the asking app's own file viewer, or in Ri's. */
export type OpenFileTarget =
  | { kind: 'app'; serverId: string; tool: string; handle: string; name: string }
  | { kind: 'attachment'; fileName: string; name: string }
  | { kind: 'agent-file'; workspaceId: string; path: string; name: string };

/**
 * `openai/files/open` from a view. The path is the execution host's, so only
 * a server on this computer may name one. It may be a file in an agent's
 * folder, a chat attachment, or another regular file outside Ri's own home.
 * The file opens in the asking app's own file viewer when it handles the
 * extension, so the file goes to no other app without the person choosing
 * it. Otherwise Ri shows its own preview (an attachment, or the agent's Files
 * tab), and a file Ri has no view for is refused.
 */
export async function openFileTarget(view: View, entry: Pick<McpServerEntry, 'url' | 'providerId'> & Partial<McpServerEntry>,
  tools: readonly { name: string; _meta?: unknown }[], requested: string): Promise<OpenFileTarget> {
  if (!serverRunsHere(entry)) throw new Error('This app runs on another computer, so the path it named is not a file here.');
  if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0')) throw new Error('Files open by absolute path.');
  const { real, source } = await forApp(async () => {
    const real = await regularFile(path.normalize(requested), 'This file does not exist.');
    if ((await fsp.stat(real)).size > MAX_HOST_FILE_BYTES) throw tooLarge();
    return { real, source: await classify(real, view.capture.serverId) };
  });
  const name = source.kind === 'attachment' ? source.fileName : path.basename(real);
  const tool = tools.find(candidate => viewMetadata(candidate)?.file.includes(extensionOf(name)) && entry.toolOverrides?.[candidate.name]?.enabled !== false);
  if (tool) {
    const { handle } = remember(view.viewerId, source, name);
    return { kind: 'app', serverId: view.capture.serverId, tool: tool.name, handle, name };
  }
  if (source.kind === 'attachment') return { kind: 'attachment', fileName: source.fileName, name };
  if (source.kind === 'agent-folder') return { kind: 'agent-file', workspaceId: source.workspaceId, path: source.path, name };
  throw new Error('Ri has no viewer for this file, and this app does not open it either.');
}
/** Which of Ri's places holds a real path. Ri's own home is closed except its attachments. */
async function classify(real: string, serverId: string): Promise<HostFileSource> {
  const attachments = await fsp.realpath(getAttachmentsDir()).catch(() => null);
  if (attachments && path.dirname(real) === attachments) return { kind: 'attachment', fileName: path.basename(real) };
  for (const workspace of listWorkspaces()) {
    if (agentDeviceFor(workspace.id)) continue;
    const root = await fsp.realpath(workspace.cwd).catch(() => null);
    if (!root || !inside(root, real) || root === real) continue;
    const relative = path.relative(root, real).split(path.sep).join('/');
    if (relative.split('/').some(isGitDir)) throw new Error('Apps cannot open files inside .git.');
    return { kind: 'agent-folder', workspaceId: workspace.id, path: relative };
  }
  await localFileAllowed(real);
  return { kind: 'local', path: real, serverId };
}
