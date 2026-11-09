import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chatSkillCommands } from './commands';
import { GET, GETInput } from '@/lib/server/operations/skills/commands';
import { operationContext } from '@/lib/server/operation';

const { getWorkspace, authorizeSkillOperation, workspaceAuthority } = vi.hoisted(() => ({
  getWorkspace: vi.fn(), authorizeSkillOperation: vi.fn(), workspaceAuthority: vi.fn(),
}));
vi.mock('@/lib/db/queries', () => ({ getWorkspace, getSkillUsageScores: () => new Map([['first-principles-thinking', 3]]) }));
vi.mock('@/lib/skills/home-policy', () => ({ authorizeSkillOperation }));
vi.mock('@/lib/workspaces/access', () => ({ workspaceAuthority, executionOperationFailure: () => null }));

let root: string;
let project: string;

function skill(dir: string, name: string, extra = '') {
  const folder = path.join(dir, name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: Review work.\n${extra}---\nUse this skill.\n`);
  return folder;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-commands-'));
  project = path.join(root, 'project');
  fs.mkdirSync(project);
  vi.stubEnv('HOME', path.join(root, 'user'));
  vi.stubEnv('RI_ROOT', root);
  getWorkspace.mockReset().mockReturnValue({ cwd: project });
  authorizeSkillOperation.mockReset().mockReturnValue(null);
  workspaceAuthority.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it('offers global, project and attached Ri skills before a chat exists, excluding drafts and model-only skills', async () => {
  skill(path.join(os.homedir(), '.claude', 'skills'), 'global-review');
  skill(path.join(project, '.agents', 'skills'), 'first-principles-thinking');
  skill(path.join(root, 'skills'), 'weekly-review');
  skill(path.join(project, '.ri', 'skills'), 'legacy-review');
  skill(path.join(root, 'skills'), 'model-only', 'user-invocable: false\n');
  skill(path.join(root, 'skill-drafts'), 'unfinished');

  const input = { query: { workspaceId: 'agent-1', harness: 'codex' as const } };
  const result = await GET(input, operationContext(new Request('http://fixture/api/trpc'), input, '/skills/commands'));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected commands');
  expect(result.data.commands.map(c => c.name).sort()).toEqual(['first-principles-thinking', 'global-review', 'legacy-review', 'weekly-review']);
  expect(result.data.commands.find(c => c.name === 'first-principles-thinking')).toMatchObject({ frecency: 3, execution: { provider: 'codex' } });
  expect(workspaceAuthority).toHaveBeenCalledWith(null, 'agent-1', 'read');
});

it('scopes project skills to the chosen folder and reconciles an existing Claude inventory', async () => {
  skill(path.join(project, '.claude', 'skills'), 'first-principles-thinking');
  skill(path.join(root, 'skills'), 'weekly-review');
  const result = await chatSkillCommands({ cwd: project, harness: 'claude', inventory: {
    provider: 'claude', source: 'provider-init', skills: ['first-principles-thinking'], slashCommands: [],
  } });
  expect(result.commands.map(c => c.name)).toEqual(['first-principles-thinking']);
  expect(result.inventorySource).toBe('provider-init');
  const elsewhere = await chatSkillCommands({ cwd: root, harness: 'claude' });
  expect(elsewhere.commands.map(c => c.name)).toEqual(['weekly-review']);
});

it('honors builder exclusions and try-chat extra folders', async () => {
  skill(path.join(root, 'skills'), 'weekly-review');
  const draft = skill(path.join(root, 'skill-drafts'), 'try-me');
  const result = await chatSkillCommands({ cwd: root, harness: 'codex', skillPlan: { exclude: ['weekly-review'], extra: [draft] } });
  expect(result.commands.map(c => c.name)).toEqual(['try-me']);
});

it('does not expose private folders to a shared Home', async () => {
  authorizeSkillOperation.mockReturnValue({ id: 'member' });
  const input = { query: { harness: 'claude' as const } };
  const result = await GET(input, operationContext(new Request('http://fixture/api/trpc'), input, '/skills/commands'));
  expect(result).toMatchObject({ ok: true, data: { commands: [], diagnostics: [], inventorySource: 'none' } });
  expect(getWorkspace).not.toHaveBeenCalled();
});

it('rejects an unknown agent and invalid harness', async () => {
  getWorkspace.mockReturnValue(null);
  const input = { query: { workspaceId: 'gone', harness: 'claude' as const } };
  expect(await GET(input, operationContext(new Request('http://fixture/api/trpc'), input, '/skills/commands'))).toMatchObject({ ok: false, status: 404 });
  expect(GETInput.safeParse({ query: { harness: 'other' } }).success).toBe(false);
});
