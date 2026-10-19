import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getAppRoot, getAttachmentsDir } from '@/lib/config/paths';
import { getWorkspace, listWorkspaces } from '@/lib/db/queries';
import { hostedMcpDefinition } from '@/lib/integrations/hosted-mcp';
import type { McpServerEntry } from '@/lib/integrations/mcp-servers';
import { processState } from '@/lib/process-state';
import { agentDeviceFor } from '@/lib/setups/run-on';
import { sanitizeRelPath } from '@/lib/workspaces/read-file';
import { viewMetadata } from './metadata';
import { MAX_DELIVERED, VIEW_TTL, type View } from './store';

/**
 * Files opened through OpenAI's file entrypoint (docs/connected-mcp-apps.md,
 * "Files"). A view never sees a path. Ri gives it an opaque host URI for the
 * file (`ri-file:<random id>`) and answers `resources/read`,
 * `resources/subscribe` and `openai/resources/write` for that URI itself.
 *
 * A handle names a file by where it lives, never by a path the browser sent:
 * a chat attachment by its stored name, an agent's file by the agent and a
 * path inside its folder, or, for `openai/files/open` from a server on this
 * computer, the path that server named. Every read, watch and write resolves
 * the handle again, so a file swapped for a symlink out of its folder after
 * it opened is refused then. Only an agent's own folder is writable: an
 * attachment is part of a message's history.
 */
export const HOST_FILE_SCHEME = 'ri-file:';
/** The largest file an app may open or save through Ri. */
export const MAX_HOST_FILE_BYTES = 32 * 1024 * 1024;
const MAX_HANDLES = 256;
const MAX_WATCHES = 64;
const MAX_WATCHES_PER_VIEW = 8;
/** How long a change waits for more before it is reported, so one save is one notice. */
const WATCH_DEBOUNCE_MS = 150;
/** A long poll for a change returns after this long with nothing new. */
export const WATCH_WAIT_MS = 20_000;

export type HostFileSource =
  | { kind: 'attachment'; fileName: string }
  | { kind: 'agent-folder'; workspaceId: string; path: string }
  | { kind: 'local'; path: string; serverId: string };
interface HostFile { id: string; viewerId: string; source: HostFileSource; name: string; created: number }
interface Watch {
  view: View; uri: string; absolute: string; revision: number; etag: string;
  watcher: fs.FSWatcher; waiters: Set<() => void>; debounce?: ReturnType<typeof setTimeout>; expiry: ReturnType<typeof setTimeout>;
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

function prune(now = Date.now()) {
  for (const [id, file] of handles()) if (file.created + VIEW_TTL <= now) handles().delete(id);
}
function remember(viewerId: string, source: HostFileSource, name: string): { handle: string; name: string } {
  prune();
  // The same file opened again by the same person keeps its handle, so its URI is stable.
  const same = [...handles().values()].find(file => file.viewerId === viewerId && JSON.stringify(file.source) === JSON.stringify(source));
  if (same) { same.created = Date.now(); return { handle: same.id, name: same.name }; }
  if (handles().size >= MAX_HANDLES) handles().delete(handles().keys().next().value!);
  const file: HostFile = { id: randomUUID(), viewerId, source, name, created: Date.now() };
  handles().set(file.id, file);
  return { handle: file.id, name };
}

/** Where a handle's file is now, after checking it is still inside where it was opened. */
async function resolveHostFile(source: HostFileSource): Promise<{ absolute: string; writable: boolean }> {
  if (source.kind === 'attachment') {
    if (!ATTACHMENT_NAME.test(source.fileName)) throw new Error('This attachment name is not valid.');
    const root = await fsp.realpath(getAttachmentsDir()).catch(() => { throw new Error('This attachment no longer exists.'); });
    const absolute = await regularFile(path.join(root, source.fileName), root, 'This attachment no longer exists.');
    return { absolute, writable: false };
  }
  if (source.kind === 'agent-folder') {
    const workspace = getWorkspace(source.workspaceId);
    if (!workspace) throw new Error('This agent no longer exists.');
    if (agentDeviceFor(source.workspaceId)) throw new Error('This agent\'s folder is on another device, so apps can\'t open its files here.');
    const relative = sanitizeRelPath(source.path);
    if (!relative || relative.split('/').includes('.git')) throw new Error('This path is not inside the agent\'s folder.');
    const root = await fsp.realpath(workspace.cwd).catch(() => { throw new Error('The agent\'s folder does not exist.'); });
    const absolute = await regularFile(path.join(root, relative), root, 'This file no longer exists in the agent\'s folder.');
    return { absolute, writable: workspace.status !== 'archived' };
  }
  if (!path.isAbsolute(source.path)) throw new Error('Files open by absolute path.');
  return { absolute: await regularFile(source.path, null, 'This file no longer exists.'), writable: false };
}
/** The real path of a regular file, refused when it leaves `root` through a symlink. */
async function regularFile(candidate: string, root: string | null, missing: string): Promise<string> {
  let real: string;
  try { real = await fsp.realpath(candidate); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(missing); throw error; }
  if (root && !inside(root, real)) throw new Error('This file is outside the folder it was opened from.');
  const stat = await fsp.stat(real);
  if (!stat.isFile()) throw new Error('Only regular files open in apps.');
  return real;
}

/** A handle for a chat attachment. Any signed-in viewer can already download one. */
export async function attachmentHandle(viewerId: string, fileName: string, originalName?: string) {
  const source: HostFileSource = { kind: 'attachment', fileName };
  await resolveHostFile(source);
  return remember(viewerId, source, displayName(originalName) ?? fileName);
}
/** A handle for a file in an agent's own folder, by the agent and a path inside it. */
export async function agentFileHandle(viewerId: string, workspaceId: string, relativePath: string) {
  const source: HostFileSource = { kind: 'agent-folder', workspaceId, path: sanitizeRelPath(relativePath) ?? relativePath };
  await resolveHostFile(source);
  return remember(viewerId, source, path.basename(source.path));
}
const displayName = (name?: string) => name && name.length <= 255 && !/[\\/\0]/.test(name) ? name : undefined;

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/** The `FileInput` a file entrypoint receives (OpenAI's spec), and the capture's record of the file. */
export async function fileLaunchInput(request: { viewerId: string; serverId: string; chatId?: string; extensions: string[]; handle?: string }): Promise<{ input: Record<string, unknown>; file: { handle: string; name: string } }> {
  prune();
  const file = request.handle ? handles().get(request.handle) : undefined;
  if (!file || file.viewerId !== request.viewerId) throw new Error('This file is no longer open here. Choose it again.');
  // A file a server named by path opens only in that server's own viewer.
  if (file.source.kind === 'local' && file.source.serverId !== request.serverId) throw new Error('This file can open only in the app that named it.');
  if (!request.extensions.includes(extensionOf(file.name))) throw new Error('This app does not open this kind of file.');
  await resolveHostFile(file.source);
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
  const { absolute, writable } = await resolveHostFile(file.source);
  if ((await fsp.stat(absolute)).size > MAX_HOST_FILE_BYTES) throw tooLarge();
  const bytes = await fsp.readFile(absolute);
  if (bytes.length > MAX_HOST_FILE_BYTES) throw tooLarge();
  if (bytes.length + view.delivered > MAX_DELIVERED) throw new Error('This app view has read too much. Open the file again to continue.');
  view.delivered += bytes.length;
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
async function currentEtag(absolute: string) {
  try { return etagOf(await fsp.readFile(absolute)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw error; }
}
function closeWatch(key: string) {
  const watch = watches().get(key);
  if (!watch) return;
  watches().delete(key);
  watch.watcher.close();
  clearTimeout(watch.debounce); clearTimeout(watch.expiry);
  for (const wake of watch.waiters) wake();
}

/**
 * `resources/subscribe`. Ri watches the file's folder, so a save that
 * replaces the file is still seen, and reports a change only when the
 * content differs. The watch ends with the view, on unsubscribe, or when the
 * view expires.
 */
export async function subscribeHostResource(view: View, uri: string): Promise<{ revision: number }> {
  const file = viewFile(view, uri);
  const key = watchKey(view, uri);
  const existing = watches().get(key);
  if (existing) return { revision: existing.revision };
  if (watches().size >= MAX_WATCHES || [...watches().values()].filter(watch => watch.view === view).length >= MAX_WATCHES_PER_VIEW)
    throw new Error('Too many files are being watched. Close another app view first.');
  const { absolute } = await resolveHostFile(file.source);
  const folder = path.dirname(absolute), base = path.basename(absolute);
  const watch: Watch = {
    view, uri, absolute, revision: 0, etag: await currentEtag(absolute), waiters: new Set(),
    watcher: fs.watch(folder, { persistent: false }, (_event, changed) => {
      if (changed !== null && changed !== base) return;
      clearTimeout(watch.debounce);
      watch.debounce = setTimeout(() => void (async () => {
        if (view.closed) { closeWatch(key); return; }
        const etag = await currentEtag(absolute).catch(() => watch.etag);
        if (etag === watch.etag || watches().get(key) !== watch) return;
        watch.etag = etag; watch.revision++;
        for (const wake of watch.waiters) wake();
      })(), WATCH_DEBOUNCE_MS);
    }),
    expiry: setTimeout(() => closeWatch(key), Math.max(0, view.created + VIEW_TTL - Date.now())),
  };
  watch.expiry.unref?.();
  watch.watcher.on('error', () => closeWatch(key));
  watches().set(key, watch);
  return { revision: 0 };
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
 * writable, compared against `ifMatch` when given, and saved atomically (a
 * temporary file in the same folder, renamed over the original), so a reader
 * never sees half a file. Writes to one file run one at a time.
 */
export async function writeHostResource(view: View, request: ResourceWrite): Promise<ResourceWriteResult> {
  const file = viewFile(view, request.uri);
  const { absolute, writable } = await resolveHostFile(file.source);
  if (!writable) throw new Error('This file is read only here. Ri saves only files in an agent\'s folder.');
  if (request.blob !== undefined && !BASE64.test(request.blob)) throw new Error('The file contents are not valid base64.');
  const bytes = request.text !== undefined ? Buffer.from(request.text, 'utf8') : Buffer.from(request.blob!, 'base64');
  if (bytes.length > MAX_HOST_FILE_BYTES) return { outcome: 'too-large', maxBytes: MAX_HOST_FILE_BYTES };
  const previous = writes().get(absolute) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async (): Promise<ResourceWriteResult> => {
    // Resolve again inside the queue: the file may have moved while this write waited.
    const target = (await resolveHostFile(file.source)).absolute;
    if ((await fsp.lstat(target)).isSymbolicLink()) throw new Error('Ri does not save through a symlink.');
    const current = await currentEtag(target);
    if (request.ifMatch !== undefined && request.ifMatch !== current) return { outcome: 'conflict', etag: current };
    const mode = (await fsp.stat(target)).mode & 0o777;
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.ri-save`);
    try {
      const handle = await fsp.open(temporary, 'wx', mode);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await fsp.rename(temporary, target);
    } catch (error) {
      await fsp.rm(temporary, { force: true });
      throw error;
    }
    const etag = etagOf(bytes);
    // The writer already knows its own save. Every other view watching this file hears about it.
    const own = watches().get(watchKey(view, request.uri));
    if (own) own.etag = etag;
    return { outcome: 'saved', etag };
  });
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
  const { absolute } = await resolveHostFile(file.source);
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
  const real = await regularFile(path.normalize(requested), null, 'This file does not exist.');
  if ((await fsp.stat(real)).size > MAX_HOST_FILE_BYTES) throw tooLarge();
  const source = await classify(real, view.capture.serverId);
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
  const home = await fsp.realpath(getAppRoot()).catch(() => getAppRoot());
  for (const workspace of listWorkspaces()) {
    if (agentDeviceFor(workspace.id)) continue;
    const root = await fsp.realpath(workspace.cwd).catch(() => null);
    if (!root || !inside(root, real) || root === real) continue;
    const relative = path.relative(root, real).split(path.sep).join('/');
    if (relative.split('/').includes('.git')) continue;
    return { kind: 'agent-folder', workspaceId: workspace.id, path: relative };
  }
  if (inside(home, real)) throw new Error('Apps cannot open Ri\'s own files.');
  return { kind: 'local', path: real, serverId };
}
