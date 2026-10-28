/**
 * Archiving a chat removes only a worktree Ri made for it. A non-git agent's
 * chats never get one: they work in the agent's own folder, which belongs
 * to the person and has to survive the archive, including a folder the
 * agent used to have (an imported chat keeps the path it ran in, and
 * agentex removes a plain folder recursively).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let q: typeof import('@/lib/db/queries');

beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-archive-agent-folder-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  q = await import('@/lib/db/queries');
});

afterEach(async () => {
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
  vi.unstubAllEnvs();
});

function plainFolder(name: string) {
  const folder = path.join(home.root, name);
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), '# Mine\n');
  return folder;
}

it("keeps a non-git agent's folder", async () => {
  const folder = plainFolder('reading-app');
  const ws = q.createWorkspace({ name: 'Reading app', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const { session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Build the reader' });

  const { archiveExecutionSession } = await import('@/lib/sessions/dispatch');
  expect((await archiveExecutionSession({ sessionId: session.id }))?.status).toBe('archived');
  expect(fs.readdirSync(folder).sort()).toEqual(['README.md', 'src']);
});

it("keeps the folder an imported chat ran in after the agent's folder moved", async () => {
  const before = plainFolder('notes-before');
  const after = plainFolder('notes-after');
  const ws = q.createWorkspace({ name: 'Notes', cwd: before, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  // An imported chat records the folder it ran in (src/lib/import/external-agents.ts).
  const { session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Imported', worktreePath: before });
  q.updateWorkspace(ws.id, { cwd: after });

  const { archiveExecutionSession } = await import('@/lib/sessions/dispatch');
  expect((await archiveExecutionSession({ sessionId: session.id }))?.status).toBe('archived');
  expect(fs.readdirSync(before).sort()).toEqual(['README.md', 'src']);
});
