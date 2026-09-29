/**
 * The home's records of every computer's folders (docs/homes-spec.md §4.1):
 * the only place an agent's folders are kept. A linked folder for every agent
 * has one place per computer. Each setup's status follows what the computer
 * found. What existed before moves in once, at boot.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let q: typeof import('@/lib/db/queries');
let hostId: string;
let laptopId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-folder-records-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  hostId = identity.ensureHomeIdentity().computer.id;
  q = await import('@/lib/db/queries');
  const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'MacBook', createdByApiKeyId: null });
  laptopId = q.redeemEnrollGrant({ secret: grant.secret, name: 'MacBook' }).computer.id;
});
afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

const agent = (name: string) =>
  q.createWorkspace({ name, cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;

describe('a linked folder for every agent', () => {
  it('has one place per computer, used by every agent there, and changing it there changes it for all', () => {
    const ri = agent('Ri');
    const docs = agent('Docs');
    const agentex = q.createReferenceFolder({ alias: 'agentex' });
    q.setAgentFolder(ri, laptopId, '/Users/trey/ri');
    q.setAgentFolder(docs, laptopId, '/Users/trey/docs');
    q.setFolderLink(laptopId, agentex.id, '/Users/trey/agentex');
    const place = (id: string) => q.getAgentSetup(id, laptopId)!.references.find((r) => r.alias === 'agentex')?.path;
    expect([place(ri), place(docs)]).toEqual(['/Users/trey/agentex', '/Users/trey/agentex']);
    q.setFolderLink(laptopId, agentex.id, '/Users/trey/code/agentex');
    expect([place(ri), place(docs)]).toEqual(['/Users/trey/code/agentex', '/Users/trey/code/agentex']);
    // The home has its own place for it, untouched.
    expect(q.getFolderLink(hostId, agentex.id)).toBeNull();
  });
});

describe("a setup's status", () => {
  it("follows what the computer found: not checked, ready, or its folder gone, saying where", () => {
    const ri = agent('Ri');
    q.setAgentFolder(ri, laptopId, '/Users/trey/ri');
    expect(q.getAgentSetup(ri, laptopId)).toMatchObject({ status: 'unchecked', found: null, problem: null });
    q.recordFolderChecks(laptopId, [{ path: '/Users/trey/ri', exists: true }]);
    expect(q.getAgentSetup(ri, laptopId)).toMatchObject({ status: 'ready', found: true });
    q.recordFolderChecks(laptopId, [{ path: '/Users/trey/ri', exists: false }]);
    expect(q.getAgentSetup(ri, laptopId)).toMatchObject({ status: 'missing_folder', problem: "Ri's folder on MacBook, /Users/trey/ri, isn't there." });
  });

  it('waits on a linked folder not chosen there, and is ready once it is, or gone without', () => {
    const ri = agent('Ri');
    const docs = q.createReferenceFolder({ workspaceId: ri, alias: 'docs' });
    q.setAgentFolder(ri, laptopId, '/Users/trey/ri');
    q.recordFolderChecks(laptopId, [{ path: '/Users/trey/ri', exists: true }]);
    expect(q.getAgentSetup(ri, laptopId)).toMatchObject({ status: 'missing_reference', problem: 'Choose where docs is on MacBook, or go without it.' });
    q.setFolderLink(laptopId, docs.id, null);
    expect(q.getAgentSetup(ri, laptopId)).toMatchObject({ status: 'ready' });
    expect(q.getAgentSetup(ri, laptopId)!.references).toEqual([expect.objectContaining({ alias: 'docs', form: 'omitted' })]);
    q.setFolderLink(laptopId, docs.id, '/Users/trey/docs');
    q.recordFolderChecks(laptopId, [{ path: '/Users/trey/docs', exists: false }]);
    expect(q.getAgentSetup(ri, laptopId)).toMatchObject({ status: 'missing_reference', problem: "docs isn't at /Users/trey/docs on MacBook." });
  });
});

describe('taking an agent off a computer', () => {
  it("forgets its folder and its own linked folders there, and keeps one every agent uses", () => {
    const ri = agent('Ri');
    const own = q.createReferenceFolder({ workspaceId: ri, alias: 'notes' });
    const shared = q.createReferenceFolder({ alias: 'agentex' });
    q.setAgentFolder(ri, laptopId, '/Users/trey/ri');
    q.setFolderLink(laptopId, own.id, '/Users/trey/notes');
    q.setFolderLink(laptopId, shared.id, '/Users/trey/agentex');
    expect(q.removeAgentSetup(ri, laptopId)).toBe(true);
    expect(q.getAgentSetup(ri, laptopId)).toBeNull();
    expect(q.getFolderLink(laptopId, own.id)).toBeNull();
    expect(q.getFolderLink(laptopId, shared.id)?.path).toBe('/Users/trey/agentex');
  });
});

describe('moving what existed before into the records, at boot', () => {
  it("gives an agent its home row, a linked folder its home place, and another computer's last report its places, once", async () => {
    const ri = agent('Ri');
    const { getDb } = await import('@/lib/db');
    const { agentSetups, referenceFolders } = await import('@/lib/db/schema');
    // As an older home had them: a linked folder with its home path on it,
    // and a laptop's report from its setup file.
    const docs = q.createReferenceFolder({ alias: 'docs' });
    getDb().update(referenceFolders).set({ path: '/Users/mini/docs' }).run();
    getDb().insert(agentSetups).values({
      id: 'laptop-setup', workspaceId: ri, computerId: laptopId, sourcePath: '/Users/trey/ri', status: 'ready', problem: null,
      reportedAt: new Date().toISOString(),
      references: [{ alias: 'docs', value: '../docs', form: 'path', path: '/Users/trey/docs', exists: true, problem: null }],
    }).run();
    const first = q.moveFolderRecords();
    expect(first).toEqual({ setups: 0, links: 2 });
    expect(q.getFolderLink(hostId, docs.id)?.path).toBe('/Users/mini/docs');
    expect(q.getFolderLink(laptopId, docs.id)?.path).toBe('/Users/trey/docs');
    expect(q.moveFolderRecords()).toEqual({ setups: 0, links: 0 });

    const legacy = agent('Legacy');
    expect(q.moveFolderRecords()).toEqual({ setups: 1, links: 0 });
    expect(q.getAgentSetup(legacy, hostId)).toMatchObject({ sourcePath: home.root });
  });
  it("takes a shared linked folder's place from an active agent there, not an archived one that reported later", async () => {
    const { getDb } = await import('@/lib/db');
    const { agentSetups } = await import('@/lib/db/schema');
    const ri = agent('Ri');
    const old = agent('Old');
    const agentex = q.createReferenceFolder({ alias: 'agentex' });
    const report = (id: string, workspaceId: string, at: string, place: string) =>
      getDb().insert(agentSetups).values({
        id, workspaceId, computerId: laptopId, sourcePath: `/Users/trey/${id}`, status: 'ready', problem: null, reportedAt: at,
        references: [{ alias: 'agentex', value: place, form: 'path', path: place, exists: true, problem: null }],
      }).run();
    // The archived one first, and later: neither order nor time decides it.
    report('old', old, '2026-09-20T00:00:00.000Z', '/Users/trey/old/agentex');
    report('ri', ri, '2026-09-01T00:00:00.000Z', '/Users/trey/code/agentex');
    q.archiveWorkspace(old);
    q.moveFolderRecords();
    expect(q.getFolderLink(laptopId, agentex.id)?.path).toBe('/Users/trey/code/agentex');
  });
});

describe("this computer's folders", () => {
  it('lists a folder within the home folder, marks projects, leaves hidden ones out, and refuses outside it', async () => {
    const { listFoldersHere, FolderListingError, checkFoldersHere } = await import('./folders-here');
    const base = fs.mkdtempSync(path.join(os.homedir(), '.ri-folders-test-'));
    try {
      fs.mkdirSync(path.join(base, 'project', '.git'), { recursive: true });
      fs.mkdirSync(path.join(base, 'plain'));
      fs.mkdirSync(path.join(base, '.hidden'));
      const listing = listFoldersHere(base);
      expect(listing.folders.map((f) => [f.name, f.isGit])).toEqual([['plain', false], ['project', true]]);
      expect(listing.parent).toBe(fs.realpathSync(os.homedir()));
      expect(() => listFoldersHere('/')).toThrow(FolderListingError);
      expect(checkFoldersHere([base, path.join(base, 'nope')])).toEqual([
        { path: base, exists: true },
        { path: path.join(base, 'nope'), exists: false },
      ]);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("keeps only what its home sent, in memory, for that home", async () => {
    const book = await import('@/lib/worker/agent-folder');
    book.setAgentFolders('home-1', [{ agentId: 'ri', sourcePath: '/Users/trey/ri' }]);
    expect(book.agentFolderHere('home-1', 'ri')).toBe('/Users/trey/ri');
    expect(book.agentFolderHere('home-2', 'ri')).toBeNull();
    book.setAgentFolders('home-1', []);
    expect(book.agentFolderHere('home-1', 'ri')).toBeNull();
    book._resetAgentFolders();
  });
});
