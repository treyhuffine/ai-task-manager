import { Command } from 'commander';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
beforeAll(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  delete process.env.RI_SESSION_CREDENTIAL; delete process.env.RI_HOME_TOOLS_URL;
  home = await createTestHome({ prefix: 'ri-probe-cli-' });
});
afterAll(async () => { await home.cleanup(); vi.unstubAllEnvs(); });

async function cli(args: string[]) {
  const { registerAgentCommand } = await import('@/cli/commands/agent');
  const out: string[] = []; const err: string[] = [];
  const so = vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => { out.push(String(s)); return true; });
  const se = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { err.push(String(s)); return true; });
  const ex = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new Error('exit:' + c); }) as never);
  try {
    const command = registerAgentCommand(new Command().exitOverride());
    await command.parent!.parseAsync(['agent', ...args], { from: 'user' }).catch((e: Error) => err.push('THROW ' + e.message));
  } finally { so.mockRestore(); se.mockRestore(); ex.mockRestore(); }
  return { out: out.join(''), err: err.join('') };
}

it('existing camelCase CLI flags on local content actions', async () => {
  const q = await import('@/lib/db/queries');
  const area = q.createArea({ name: 'CLI area' });
  const before = q.listTasks().length;
  const r1 = await cli(['create_task', '--title', 'CLI areaId', '--areaId', area.id]);
  const r2 = await cli(['create_task', '--title', 'CLI hardDeadline', '--hardDeadline', '2026-11-01']);
  const r3 = await cli(['list_tasks', '--orderBy', 'createdAt']);
  const r4 = await cli(['create_note', '--body', 'CLI note', '--areaId', area.id]);
  const r5 = await cli(['list_notes', '--areaId', area.id]);
  const r6 = await cli(['create_task', '--title', 'CLI plain']);
  const tid = q.listTasks()[0].id;
  const r7 = await cli(['update_task', tid, '--areaId', area.id]);
  const r8 = await cli(['create_task', '--input', JSON.stringify({ title: 'CLI input areaId', areaId: area.id })]);
  const r9 = await cli(['create_task', '--title', 'CLI kebab', '--area-id', area.id]);
  const r10 = await cli(['list_notes', '--orderBy', 'createdAt']);
  const r11 = await cli(['update_task', tid, '--hardDeadline', '2026-11-09']);
  for (const result of [r1,r2,r3,r4,r5,r6,r7,r8,r9,r10,r11]) {
    expect(result.err).toBe('');
    expect(JSON.parse(result.out)).toBeTruthy();
  }
  expect(q.listTasks().length - before).toBe(5);
  expect(q.getTask(tid)).toMatchObject({ areaId: area.id, hardDeadline: '2026-11-09' });
  expect(q.listNotes({ areaId: area.id })).toHaveLength(1);
}, 60_000);

it('rejects conflicting aliases before writing and treats own Home as local', async () => {
  const q = await import('@/lib/db/queries');
  const { ensureHomeIdentity } = await import('@/lib/home/identity');
  ensureHomeIdentity();
  const count = q.listTasks().length;
  const rejected = await cli(['create_task', '--input', JSON.stringify({ title: 'conflict', areaId: 'one', area_id: 'two' })]);
  expect(rejected.err).toContain('invalid_params');
  expect(q.listTasks()).toHaveLength(count);
  const created = await cli(['create_task', '--title', 'own Home', '--target-home-id', q.getHome()!.id, '--idempotency-key', 'x']);
  expect(created.err).toBe('');
  const teamField = await cli(['list_tasks', '--assigned-to-me', 'true']);
  expect(teamField.err).toContain('invalid_params');
  const area = q.createArea({ name: 'Override area' });
  const overridden = await cli(['create_task', '--title', 'Override JSON', '--area-id', 'ignored-flag', '--input', JSON.stringify({ areaId: area.id })]);
  expect(overridden.err).toBe('');
  expect(JSON.parse(overridden.out).areaId).toBe(area.id);
});
