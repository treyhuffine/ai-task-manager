import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { processState } from '@/lib/process-state';

const mocks = vi.hoisted(() => ({workspaces: [] as {id: string; cwd: string; status: string}[], remote: new Set<string>(),
  sessions: [] as {id: string; worktreePath: string | null; status: string}[], elsewhere: new Set<string>()}));
vi.mock('@/lib/db/queries', () => ({
  getWorkspace: (id: string) => mocks.workspaces.find(workspace => workspace.id === id),
  listWorkspaces: () => mocks.workspaces,
  getChatSessionWithExecution: (id: string) => mocks.sessions.find(session => session.id === id),
  chatPlacement: (id: string) => mocks.elsewhere.has(id) ? {isHome: false, deviceId: 'laptop'} : {isHome: true},
}));
vi.mock('@/lib/setups/run-on', () => ({agentDeviceFor: (id: string) => mocks.remote.has(id) ? 'laptop' : null}));
import {
  agentFileHandle, attachmentHandle, closeHostWatches, sessionFileHandle, etagOf, fileCallMeta, fileLaunchInput, isHostResource, MAX_HOST_FILE_BYTES, MAX_HOST_WRITE_BYTES, openFileTarget, readHostResource,
  SAVE_SUFFIX, serverRunsHere, subscribeHostResource, unsubscribeHostResource, waitHostResource, writeHostResource,
} from './files';
import type { View } from './store';

// Bits & Bolts' file viewer: `cad.open` handles CAD files and reads the opened file through the host.
const CAD = ['.stl', '.3mf', '.step', '.stp'];
const cadTools = [{name: 'cad.open', _meta: {ui: {resourceUri: 'ui://bits-and-bolts/file-v35'}, 'openai/ui': {entrypoints: [{type: 'file', extensions: CAD}]}}}, {name: 'cad.listParts'}];
const STL = 'solid hex-bolt\nendsolid hex-bolt\n';
const local = {url: 'http://localhost:3917/mcp'};
const remote = {url: 'https://bits.example/mcp'};

let root: string, home: string, folder: string, outside: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-host-files-')));
  home = path.join(root, 'home'); folder = path.join(root, 'agent'); outside = path.join(root, 'outside');
  for (const dir of [path.join(home, 'attachments'), path.join(folder, 'parts'), path.join(folder, '.git'), outside]) fs.mkdirSync(dir, {recursive: true});
  process.env.RI_ROOT = home;
  fs.writeFileSync(path.join(folder, 'parts', 'hex-bolt.stl'), STL);
  fs.writeFileSync(path.join(folder, '.git', 'config'), '[core]');
  fs.writeFileSync(path.join(outside, 'secret.stl'), 'solid secret\nendsolid secret\n');
  fs.writeFileSync(path.join(home, 'attachments', '01a1-bracket.stl'), Buffer.from([0x80, 0x00, 0xff, 0x10]));
  fs.writeFileSync(path.join(home, 'data.db'), 'sqlite');
  mocks.workspaces = [{id: 'agent', cwd: folder, status: 'active'}];
  mocks.remote.clear();
  // An execution's worktree, here the same folder, reached through its chat.
  mocks.sessions = [{id: 'chat', worktreePath: folder, status: 'active'}, {id: 'archived-chat', worktreePath: folder, status: 'archived'}, {id: 'no-folder', worktreePath: null, status: 'active'}];
  mocks.elsewhere.clear();
});
afterEach(() => {
  // A spy left behind by a failed assertion would race every later test.
  vi.restoreAllMocks();
  delete process.env.RI_ROOT;
  // A test that made something read only or unreadable gives it back, so the folder can be removed.
  const writable = (dir: string) => {
    fs.chmodSync(dir, 0o755);
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.isDirectory()) writable(path.join(dir, entry.name));
      else if (entry.isFile()) fs.chmodSync(path.join(dir, entry.name), 0o644);
    }
  };
  writable(root);
  fs.rmSync(root, {recursive: true, force: true});
});

/** A file view as the service holds one, opened on `handle`. */
const fileView = (handle: string, name: string, viewerId = 'viewer'): View => ({
  id: randomUUID(), viewerId, created: Date.now(), bytes: 0, revision: 0, contextSecond: 0, contextCount: 0, closed: false, calls: new Map(),
  capture: {id: randomUUID(), serverId: 'bnb', connectionId: 'c', sourceRef: 'r', tool: 'cad.open', input: {}, result: {content: []}, resourceUri: 'ui://bits-and-bolts/file-v35',
    legacy: false, title: 'Bits & Bolts', created: Date.now(), kind: 'file', file: {handle, name}},
});
async function openedAgentFile(relative = 'parts/hex-bolt.stl', viewerId = 'viewer') {
  const {handle, name} = await agentFileHandle(viewerId, 'agent', relative);
  const {input} = await fileLaunchInput({viewerId, serverId: 'bnb', extensions: CAD, handle});
  return {handle, name, uri: (input.file as {resourceUri: string}).resourceUri, view: fileView(handle, name, viewerId)};
}

describe('host file handles', () => {
  it('gives a file entrypoint an opaque URI and the file name, never a path', async () => {
    const {handle} = await agentFileHandle('viewer', 'agent', 'parts/hex-bolt.stl');
    const {input, file} = await fileLaunchInput({viewerId: 'viewer', serverId: 'bnb', extensions: CAD, handle});
    expect(input).toEqual({file: {name: 'hex-bolt.stl', resourceUri: `ri-file:${handle}`}});
    expect(JSON.stringify(input)).not.toContain(folder);
    expect(isHostResource(`ri-file:${handle}`)).toBe(true);
    expect(isHostResource('cad://parts/hex-bolt')).toBe(false);
    expect(file).toEqual({handle, name: 'hex-bolt.stl'});
    // The same file opened again keeps its URI.
    expect((await agentFileHandle('viewer', 'agent', './parts/hex-bolt.stl')).handle).toBe(handle);
  });

  it('keeps a handle inside its folder: no traversal, no link out, no .git, no other device', async () => {
    await expect(agentFileHandle('viewer', 'agent', '../outside/secret.stl')).rejects.toThrow('not inside');
    await expect(agentFileHandle('viewer', 'agent', path.join(outside, 'secret.stl'))).rejects.toThrow('not inside');
    await expect(agentFileHandle('viewer', 'agent', '.git/config')).rejects.toThrow('not inside');
    fs.symlinkSync(path.join(outside, 'secret.stl'), path.join(folder, 'parts', 'link.stl'));
    await expect(agentFileHandle('viewer', 'agent', 'parts/link.stl')).rejects.toThrow('outside the folder');
    await expect(agentFileHandle('viewer', 'agent', 'parts')).rejects.toThrow('regular files');
    // `.git` in any letter case, which on macOS names the same folder.
    await expect(agentFileHandle('viewer', 'agent', '.GIT/config')).rejects.toThrow('not inside');
    await expect(sessionFileHandle('viewer', 'chat', '.Git/config')).rejects.toThrow('not inside');
    mocks.remote.add('agent');
    await expect(agentFileHandle('viewer', 'agent', 'parts/hex-bolt.stl')).rejects.toThrow('another device');
    await expect(attachmentHandle('viewer', '../data.db')).rejects.toThrow('not valid');
  });

  it('opens only for the person who chose the file, in an app that lists its extension', async () => {
    const {handle} = await agentFileHandle('viewer', 'agent', 'parts/hex-bolt.stl');
    await expect(fileLaunchInput({viewerId: 'someone-else', serverId: 'bnb', extensions: CAD, handle})).rejects.toThrow('no longer open');
    await expect(fileLaunchInput({viewerId: 'viewer', serverId: 'bnb', extensions: ['.ipynb'], handle})).rejects.toThrow('kind of file');
    await expect(fileLaunchInput({viewerId: 'viewer', serverId: 'bnb', extensions: CAD, handle: 'forged'})).rejects.toThrow('no longer open');
  });

  it('checks where the file lands on every read, so one replaced by a link out of its folder is refused', async () => {
    const {uri, view} = await openedAgentFile();
    fs.rmSync(path.join(folder, 'parts', 'hex-bolt.stl'));
    fs.symlinkSync(path.join(outside, 'secret.stl'), path.join(folder, 'parts', 'hex-bolt.stl'));
    await expect(readHostResource(view, uri)).rejects.toThrow('outside the folder');
    await expect(writeHostResource(view, {uri, text: 'escaped'})).rejects.toThrow('outside the folder');
    expect(fs.readFileSync(path.join(outside, 'secret.stl'), 'utf8')).toBe('solid secret\nendsolid secret\n');
  });

  it('judges a symlink by where it lands: into .git or out of the folder is refused, inside is followed', async () => {
    // The name is innocent: only where the link lands gives it away.
    fs.symlinkSync('../.git/config', path.join(folder, 'parts', 'git.stl'));
    await expect(agentFileHandle('viewer', 'agent', 'parts/git.stl')).rejects.toThrow('inside .git');
    await expect(sessionFileHandle('viewer', 'chat', 'parts/git.stl')).rejects.toThrow('inside .git');
    fs.symlinkSync(outside, path.join(folder, 'linked-outside'));
    await expect(agentFileHandle('viewer', 'agent', 'linked-outside/secret.stl')).rejects.toThrow('outside the folder');
    // A link that stays inside the folder is just another way to the same file.
    fs.symlinkSync('parts', path.join(folder, 'linked-parts'));
    const {uri, view} = await openedAgentFile('linked-parts/hex-bolt.stl');
    expect((await readHostResource(view, uri)).contents[0]).toMatchObject({text: STL});
  });
});

describe('files in an execution\'s worktree', () => {
  it('open through the chat with the same rules as its own file routes', async () => {
    const {handle, name} = await sessionFileHandle('viewer', 'chat', 'parts/hex-bolt.stl');
    expect(name).toBe('hex-bolt.stl');
    const {input} = await fileLaunchInput({viewerId: 'viewer', serverId: 'bnb', extensions: CAD, handle});
    const view = fileView(handle, name);
    const [content] = (await readHostResource(view, (input.file as {resourceUri: string}).resourceUri)).contents;
    expect(content).toMatchObject({text: STL, _meta: {'openai/resource': {writable: true}}});
    await expect(sessionFileHandle('viewer', 'chat', '../outside/secret.stl')).rejects.toThrow('not inside');
    await expect(sessionFileHandle('viewer', 'chat', '.git/config')).rejects.toThrow('not inside');
    await expect(sessionFileHandle('viewer', 'missing', 'parts/hex-bolt.stl')).rejects.toThrow('no longer exists');
    await expect(sessionFileHandle('viewer', 'no-folder', 'parts/hex-bolt.stl')).rejects.toThrow('no folder');
    mocks.elsewhere.add('chat');
    await expect(sessionFileHandle('viewer', 'chat', 'parts/hex-bolt.stl')).rejects.toThrow('another device');
  });

  it('are read only once the chat is archived', async () => {
    const {handle, name} = await sessionFileHandle('viewer', 'archived-chat', 'parts/hex-bolt.stl');
    const {input} = await fileLaunchInput({viewerId: 'viewer', serverId: 'bnb', extensions: CAD, handle});
    const [content] = (await readHostResource(fileView(handle, name), (input.file as {resourceUri: string}).resourceUri)).contents;
    expect(content?._meta).toMatchObject({'openai/resource': {writable: false}});
  });
});

describe('resources/read for the opened file', () => {
  it('reads UTF-8 as text and anything else as a blob, with a content etag and the writable hint', async () => {
    const {uri, view} = await openedAgentFile();
    const read = await readHostResource(view, uri);
    expect(read.contents).toEqual([{uri, mimeType: 'model/stl', text: STL, _meta: {'openai/resource': {etag: etagOf(Buffer.from(STL)), writable: true}}}]);
    const blob = await readHostResource(view, uri, {'openai/resource': {representation: 'blob'}});
    expect(Buffer.from(blob.contents[0].blob!, 'base64').toString()).toBe(STL);
    const attachment = await attachmentHandle('viewer', '01a1-bracket.stl', 'bracket.stl');
    const opened = fileView(attachment.handle, attachment.name);
    const binary = await readHostResource(opened, `ri-file:${attachment.handle}`);
    expect(binary.contents[0]).toMatchObject({blob: Buffer.from([0x80, 0x00, 0xff, 0x10]).toString('base64'), _meta: {'openai/resource': {writable: false}}});
    expect(binary.contents[0].text).toBeUndefined();
    expect(attachment.name).toBe('bracket.stl');
  });

  it('reads only the file the view opened, for its own viewer', async () => {
    const first = await openedAgentFile();
    const {handle} = await attachmentHandle('viewer', '01a1-bracket.stl');
    await expect(readHostResource(first.view, `ri-file:${handle}`)).rejects.toThrow('only the file it opened');
    await expect(readHostResource({...first.view, viewerId: 'someone-else'}, first.uri)).rejects.toThrow('only the file it opened');
    await expect(readHostResource({...first.view, capture: {...first.view.capture, kind: 'global'}}, first.uri)).rejects.toThrow('only the file it opened');
  });

  it('marks an archived agent\'s file read only', async () => {
    mocks.workspaces[0].status = 'archived';
    const {uri, view} = await openedAgentFile();
    expect((await readHostResource(view, uri)).contents[0]._meta).toEqual({'openai/resource': {etag: etagOf(Buffer.from(STL)), writable: false}});
    await expect(writeHostResource(view, {uri, text: 'x'})).rejects.toThrow('This agent is archived, so its files are read only.');
  });

  it('offers a file or folder its owner made read only as read only, and refuses to save it', async () => {
    const target = path.join(folder, 'parts', 'hex-bolt.stl');
    const {uri, view} = await openedAgentFile();
    fs.chmodSync(target, 0o444);
    expect((await readHostResource(view, uri)).contents[0]._meta).toMatchObject({'openai/resource': {writable: false}});
    await expect(writeHostResource(view, {uri, text: 'x'})).rejects.toThrow('This file is read only.');
    fs.chmodSync(target, 0o644);
    // A save makes a new file beside the old one, so the folder must take one.
    fs.chmodSync(path.join(folder, 'parts'), 0o555);
    expect((await readHostResource(view, uri)).contents[0]._meta).toMatchObject({'openai/resource': {writable: false}});
    await expect(writeHostResource(view, {uri, text: 'x'})).rejects.toThrow('permission');
    fs.chmodSync(path.join(folder, 'parts'), 0o755);
    expect(fs.readFileSync(target, 'utf8')).toBe(STL);
  });

  it('tells the app what went wrong without naming this computer\'s paths', async () => {
    const target = path.join(folder, 'parts', 'hex-bolt.stl');
    const {uri, view} = await openedAgentFile();
    fs.chmodSync(target, 0o000);
    const error = await readHostResource(view, uri).then(() => null, (error: Error) => error);
    expect(error?.message).toBe('Ri does not have permission to use this file.');
    fs.chmodSync(target, 0o644);
    fs.chmodSync(path.join(folder, 'parts'), 0o000);
    const walked = await readHostResource(view, uri).then(() => null, (error: Error) => error);
    expect(walked?.message).toBe('Ri does not have permission to use this file.');
    for (const message of [error?.message, walked?.message]) expect(message).not.toContain(root);
  });
});

describe('openai/resources/write', () => {
  it('saves atomically with a matching etag and returns the new one, keeping the mode and leaving nothing behind', async () => {
    const target = path.join(folder, 'parts', 'hex-bolt.stl');
    fs.chmodSync(target, 0o640);
    const {uri, view} = await openedAgentFile();
    const edited = 'solid edited-hex-bolt\nendsolid edited-hex-bolt\n';
    const saved = await writeHostResource(view, {uri, text: edited, ifMatch: etagOf(Buffer.from(STL))});
    expect(saved).toEqual({outcome: 'saved', etag: etagOf(Buffer.from(edited))});
    expect(fs.readFileSync(target, 'utf8')).toBe(edited);
    expect(fs.statSync(target).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(path.join(folder, 'parts'))).toEqual(['hex-bolt.stl']);
    // A shorter save leaves none of the longer one behind.
    const blob = Buffer.from([1, 2, 3]);
    expect(await writeHostResource(view, {uri, blob: blob.toString('base64')})).toEqual({outcome: 'saved', etag: etagOf(blob)});
    expect(fs.readFileSync(target)).toEqual(blob);
    expect(await writeHostResource(view, {uri, text: ''})).toEqual({outcome: 'saved', etag: etagOf(Buffer.alloc(0))});
    expect(fs.statSync(target).size).toBe(0);
  });

  it('leaves the file whole when a save fails partway, and nothing beside it', async () => {
    const target = path.join(folder, 'parts', 'hex-bolt.stl');
    const {uri, view} = await openedAgentFile();
    const open = fsp.open.bind(fsp);
    // The new file's write runs out of space halfway.
    vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      const handle = await open(...args);
      if (args[1] === 'wx') {
        handle.writeFile = (async (data: Buffer) => {
          await handle.write(data, 0, Math.ceil(data.length / 2), 0);
          throw Object.assign(new Error(`ENOSPC: no space left on device, write '${target}'`), {code: 'ENOSPC'});
        }) as typeof handle.writeFile;
      }
      return handle;
    });
    await expect(writeHostResource(view, {uri, text: 'x'.repeat(4096)})).rejects.toThrow('The disk is full, so the file was not saved.');
    vi.restoreAllMocks();
    expect(fs.readFileSync(target, 'utf8')).toBe(STL);
    expect(fs.readdirSync(path.join(folder, 'parts')).filter(name => name.endsWith(SAVE_SUFFIX))).toEqual([]);
  });

  it('gives a hard link made mid-save the old content, not the save', async () => {
    const target = path.join(folder, 'parts', 'hex-bolt.stl'), other = path.join(folder, 'other-name.stl');
    const {uri, view} = await openedAgentFile();
    const rename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (...args: Parameters<typeof fsp.rename>) => { fs.linkSync(target, other); return rename(...args); });
    expect(await writeHostResource(view, {uri, text: 'saved'})).toMatchObject({outcome: 'saved'});
    expect(fs.readFileSync(target, 'utf8')).toBe('saved');
    expect(fs.readFileSync(other, 'utf8')).toBe(STL);
  });

  it('reports a conflict with the current etag and leaves the file alone', async () => {
    const {uri, view} = await openedAgentFile();
    fs.writeFileSync(path.join(folder, 'parts', 'hex-bolt.stl'), 'changed elsewhere');
    expect(await writeHostResource(view, {uri, text: 'mine', ifMatch: etagOf(Buffer.from(STL))}))
      .toEqual({outcome: 'conflict', etag: etagOf(Buffer.from('changed elsewhere'))});
    expect(fs.readFileSync(path.join(folder, 'parts', 'hex-bolt.stl'), 'utf8')).toBe('changed elsewhere');
  });

  it('refuses an oversized save with the limit, an attachment, bad base64 and another file', async () => {
    const {uri, view} = await openedAgentFile();
    // A save crosses the view's relay as one message, so it is smaller than what an app may read.
    expect(MAX_HOST_WRITE_BYTES).toBe(12 * 1024 * 1024);
    expect(MAX_HOST_WRITE_BYTES).toBeLessThan(MAX_HOST_FILE_BYTES);
    expect(await writeHostResource(view, {uri, text: 'x'.repeat(MAX_HOST_WRITE_BYTES + 1)})).toEqual({outcome: 'too-large', maxBytes: MAX_HOST_WRITE_BYTES});
    await expect(writeHostResource(view, {uri, blob: 'not base64!'})).rejects.toThrow('base64');
    const attachment = await attachmentHandle('viewer', '01a1-bracket.stl');
    await expect(writeHostResource(fileView(attachment.handle, attachment.name), {uri: `ri-file:${attachment.handle}`, text: 'x'}))
      .rejects.toThrow('Attachments are read only. Apps can save files only in an agent\'s folder or a chat\'s folder.');
    await expect(writeHostResource(view, {uri: `ri-file:${attachment.handle}`, text: 'x'})).rejects.toThrow('only the file it opened');
    expect(fs.readFileSync(path.join(folder, 'parts', 'hex-bolt.stl'), 'utf8')).toBe(STL);
  });
});

describe('resources/subscribe', () => {
  it('reports another writer\'s change, not the view\'s own save, and ends on unsubscribe', async () => {
    const {uri, view} = await openedAgentFile();
    expect(await subscribeHostResource(view, uri)).toEqual({revision: 0});
    await writeHostResource(view, {uri, text: 'saved by the view'});
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(await waitHostResource(view, uri, 0, AbortSignal.timeout(50))).toEqual({revision: 0, watching: true});
    const waiting = waitHostResource(view, uri, 0);
    fs.writeFileSync(path.join(folder, 'parts', 'hex-bolt.stl'), 'saved by an editor');
    expect(await waiting).toEqual({revision: 1, watching: true});
    unsubscribeHostResource(view, uri);
    expect(await waitHostResource(view, uri, 1)).toEqual({revision: 1, watching: false});
  }, 15_000);

  it('says a watch that can\'t start in the app\'s terms, never with the folder\'s path', async () => {
    const {uri, view} = await openedAgentFile();
    const failed = vi.spyOn(fs, 'watch').mockImplementationOnce(() => {
      throw Object.assign(new Error(`EMFILE: too many open files, watch '${path.join(folder, 'parts')}'`), {code: 'EMFILE'});
    });
    try {
      const refusal = await subscribeHostResource(view, uri).then(() => null, (error: Error) => error.message);
      expect(refusal).toBe('This file is busy. Try again.');
      expect(refusal).not.toContain(folder);
    } finally { failed.mockRestore(); }
  });

  it('ends a view\'s watches when it closes, waking a waiting poll', async () => {
    const {uri, view} = await openedAgentFile();
    const other = await openedAgentFile('parts/hex-bolt.stl', 'someone-else');
    await subscribeHostResource(view, uri);
    await subscribeHostResource(other.view, other.uri);
    const waiting = waitHostResource(view, uri, 0);
    view.closed = true;
    closeHostWatches(view);
    expect(await waiting).toEqual({revision: 0, watching: false});
    // Another view's watch on the same file carries on.
    expect(await waitHostResource(other.view, other.uri, 0, AbortSignal.timeout(50))).toEqual({revision: 0, watching: true});
    unsubscribeHostResource(other.view, other.uri);
  });

  it('starts no watch for a view that closed while it subscribed, and one for two subscribes at once', async () => {
    const watching = () => [...processState('mcp-app-host-file-watches', () => new Map<string, {view: unknown}>()).values()];
    const started = vi.spyOn(fs, 'watch');
    const closing = await openedAgentFile();
    const subscribing = subscribeHostResource(closing.view, closing.uri);
    closing.view.closed = true;
    closeHostWatches(closing.view);
    expect(await subscribing).toEqual({revision: 0});
    expect(started).not.toHaveBeenCalled();
    expect(watching().filter(watch => watch.view === closing.view)).toEqual([]);
    const {uri, view} = await openedAgentFile('parts/hex-bolt.stl', 'someone-else');
    expect(await Promise.all([subscribeHostResource(view, uri), subscribeHostResource(view, uri)])).toEqual([{revision: 0}, {revision: 0}]);
    expect(started).toHaveBeenCalledTimes(1);
    unsubscribeHostResource(view, uri);
  });
});

describe('a file view\'s tool calls and openai/files/open', () => {
  it('checks a server-named file against Ri\'s home on every read, wherever its path lands', async () => {
    const {view} = await openedAgentFile();
    const opened = await openFileTarget(view, local, cadTools, path.join(outside, 'secret.stl'));
    if (opened.kind !== 'app') throw new Error('Expected the app');
    await fileLaunchInput({viewerId: 'viewer', serverId: 'bnb', extensions: CAD, handle: opened.handle});
    const libraryView = fileView(opened.handle, opened.name);
    const uri = `ri-file:${opened.handle}`;
    expect((await readHostResource(libraryView, uri)).contents[0]).toMatchObject({text: 'solid secret\nendsolid secret\n', _meta: {'openai/resource': {writable: false}}});
    // Ri's home now holds the file, so it is Ri's own and closed.
    process.env.RI_ROOT = root;
    await expect(readHostResource(libraryView, uri)).rejects.toThrow('Ri\'s own files');
    process.env.RI_ROOT = home;
    // A folder on its path replaced by a link into Ri's home: the path now lands on Ri's own files.
    fs.renameSync(outside, `${outside}-moved`);
    fs.mkdirSync(path.join(home, 'attachments', 'lib'));
    fs.writeFileSync(path.join(home, 'attachments', 'lib', 'secret.stl'), 'solid ri\nendsolid ri\n');
    fs.symlinkSync(path.join(home, 'attachments', 'lib'), outside);
    await expect(readHostResource(libraryView, uri)).rejects.toThrow('Ri\'s own files');
  });

  it('adds the file path to tool calls only for a server on this computer', async () => {
    const {view} = await openedAgentFile();
    expect(await fileCallMeta(view, local)).toEqual({'openai/resource': {path: path.join(folder, 'parts', 'hex-bolt.stl')}});
    expect(await fileCallMeta(view, {url: 'http://127.0.0.1:3917/mcp'})).toBeDefined();
    expect(await fileCallMeta(view, remote)).toBeUndefined();
    expect(await fileCallMeta({...view, capture: {...view.capture, kind: 'global'}}, local)).toBeUndefined();
    expect([serverRunsHere({url: 'http://ri.localhost/mcp'}), serverRunsHere({url: 'http://[::1]:3/mcp'}), serverRunsHere({url: 'https://localhost.example/mcp'})]).toEqual([true, true, false]);
  });

  it('opens a named file in the asking app\'s own viewer, Ri\'s preview, or not at all', async () => {
    const {view} = await openedAgentFile();
    const inFolder = await openFileTarget(view, local, cadTools, path.join(folder, 'parts', 'hex-bolt.stl'));
    expect(inFolder).toMatchObject({kind: 'app', serverId: 'bnb', tool: 'cad.open', name: 'hex-bolt.stl'});
    // Bits & Bolts hands out its own library paths (cad.partPath), outside any folder Ri knows.
    const library = await openFileTarget(view, local, cadTools, path.join(outside, 'secret.stl'));
    expect(library).toMatchObject({kind: 'app', tool: 'cad.open'});
    if (library.kind !== 'app') throw new Error('Expected the app');
    // That handle opens only in the app that named it.
    await expect(fileLaunchInput({viewerId: 'viewer', serverId: 'another-app', extensions: CAD, handle: library.handle})).rejects.toThrow('only in the app that named it');
    expect(await openFileTarget(view, local, [], path.join(folder, 'parts', 'hex-bolt.stl'))).toMatchObject({kind: 'agent-file', workspaceId: 'agent', path: 'parts/hex-bolt.stl'});
    expect(await openFileTarget(view, local, [], path.join(home, 'attachments', '01a1-bracket.stl'))).toMatchObject({kind: 'attachment', fileName: '01a1-bracket.stl'});
    await expect(openFileTarget(view, local, [], path.join(outside, 'secret.stl'))).rejects.toThrow('no viewer');
    await expect(openFileTarget(view, remote, cadTools, path.join(folder, 'parts', 'hex-bolt.stl'))).rejects.toThrow('another computer');
    await expect(openFileTarget(view, local, cadTools, 'parts/hex-bolt.stl')).rejects.toThrow('absolute path');
    await expect(openFileTarget(view, local, cadTools, path.join(home, 'data.db'))).rejects.toThrow('Ri\'s own files');
    // A repository's internals never open, in Ri's preview or the app's own viewer, in any letter case.
    await expect(openFileTarget(view, local, [], path.join(folder, '.git', 'config'))).rejects.toThrow('inside .git');
    if (fs.existsSync(path.join(folder, '.GIT'))) await expect(openFileTarget(view, local, cadTools, path.join(folder, '.GIT', 'config'))).rejects.toThrow('inside .git');
    fs.writeFileSync(path.join(folder, '.git', 'pack.stl'), STL);
    await expect(openFileTarget(view, local, cadTools, path.join(folder, '.git', 'pack.stl'))).rejects.toThrow('inside .git');
  });
});
