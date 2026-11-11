import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runUpdate, type HomeClient, type HomeStatus, type UpdateRunDeps } from './update-run';
import type { InstalledHome } from './store';
import type { Origin } from './origin';

const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);
const COMMIT = 'c'.repeat(40);
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-update-run-test-'));
  vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

function home(name: string): InstalledHome {
  const directory = path.join(root, name);
  return { id: name.padEnd(24, '0'), directory, identity: { root: directory, database: `${directory}/data.db`, config: `${directory}/.config`, work: `${directory}/.work` },
    active: OLD, previous: null, pending: null, activation: { candidate: null, previous: null } };
}

/** A Home's controller: switches when asked, unless it is busy or the new release won't start. */
function controller(behavior: 'switches' | 'busy' | 'reverts' | 'stopped') {
  let runId = 'run-1';
  let build = OLD;
  let update: HomeStatus['update'] = { format: 1, phase: 'idle', changedAt: '' };
  const requests: unknown[] = [];
  const homeClient: HomeClient = {
    status: async () => behavior === 'stopped' ? null : { protocol: 1, runId, phase: 'running', release: { release: { build, version: '0.1.0', source: 'packaged' } }, update } as unknown as HomeStatus,
    request: async (_route, _method, _timeout, body) => {
      requests.push(body);
      const action = (body as { action: string }).action;
      if (action === 'offer') update = { format: 1, phase: 'ready', changedAt: '' };
      if (action === 'apply' || action === 'apply-now') {
        if (behavior === 'busy' && action === 'apply') update = { format: 1, phase: 'waiting', reason: '1 chat', changedAt: '' };
        else if (behavior === 'reverts') { runId = 'run-2'; update = { format: 1, phase: 'failed', error: "The update didn't start, so Ri went back to the version it ran before.", changedAt: '' }; }
        else { runId = 'run-2'; build = NEW; update = { format: 1, phase: 'committed', changedAt: '' }; }
      }
      return {} as never;
    },
  };
  return { client: homeClient, requests };
}

function deps(homes: InstalledHome[], clients: Record<string, HomeClient>, origin: Partial<Origin> = {}) {
  const said: string[] = [];
  const build = vi.fn(async () => ({ id: NEW, version: '0.2.0', commit: COMMIT, log: '' }));
  const value: UpdateRunDeps = {
    homes: () => homes, client: identity => clients[identity.root], origin: () => ({ version: 1, source: 'checkout', checkout: '/src/ri', channel: 'stable', auto: true, ...origin }),
    select: () => ({ commit: COMMIT, ref: 'main', fetched: true }), build, launcher: () => ({ file: '/x/ri', installed: true }),
    say: line => said.push(line), sleep: async () => {}, now: (() => { let t = 0; return () => (t += 1000); })(),
  };
  return { value, said, build };
}

it('builds main once and switches every running Home to it', async () => {
  const personal = home('personal'); const team = home('team'); const stopped = home('stopped');
  const a = controller('switches'); const b = controller('switches'); const c = controller('stopped');
  const run = deps([personal, team, stopped], { [personal.identity!.root]: a.client, [team.identity!.root]: b.client, [stopped.identity!.root]: c.client });
  const outcomes = await runUpdate({}, run.value);
  expect(run.build).toHaveBeenCalledOnce();
  expect(outcomes.map(outcome => outcome.result)).toEqual(['updated', 'updated', 'not-running']);
  expect(a.requests).toEqual([{ action: 'offer', release: NEW, local: { commit: COMMIT, checkout: '/src/ri' } }, { action: 'apply' }]);
  expect(run.said.join('\n')).toContain('Your Homes keep running while it builds.');
});

it('says what a busy Home is waiting for, and switches it at once with --now', async () => {
  const personal = home('personal');
  const busy = controller('busy');
  const first = deps([personal], { [personal.identity!.root]: busy.client });
  expect((await runUpdate({}, first.value))[0]).toMatchObject({ result: 'waiting', reason: '1 chat' });
  expect(first.said.at(-1)).toContain('ri update --now');
  const now = deps([personal], { [personal.identity!.root]: busy.client });
  expect((await runUpdate({ now: true }, now.value))[0]).toMatchObject({ result: 'updated' });
  expect(busy.requests.at(-1)).toEqual({ action: 'apply-now' });
});

it('reports a release that would not start as gone back, not as updated', async () => {
  const personal = home('personal');
  const reverting = controller('reverts');
  const run = deps([personal], { [personal.identity!.root]: reverting.client });
  expect((await runUpdate({}, run.value))[0]).toMatchObject({ result: 'reverted', reason: expect.stringContaining('went back') });
});

it('without a feed or a checkout, explains where releases can come from', async () => {
  const personal = home('personal');
  const run = deps([personal], { [personal.identity!.root]: controller('switches').client }, { source: 'published', checkout: undefined });
  expect(await runUpdate({}, run.value)).toEqual([]);
  expect(run.said[0]).toContain('ri update --from <folder>');
});

it('installs Ri even before there is a Home, and says how to make one', async () => {
  const run = deps([], {});
  expect(await runUpdate({}, run.value)).toEqual([]);
  expect(run.said.at(-1)).toContain('ri start');
});

it('leaves a Home with no release alone and says how to move it, since it could never switch', async () => {
  const unmoved = { ...home('team'), active: null };
  const running = home('personal');
  const team = controller('switches'); const personal = controller('switches');
  const run = deps([unmoved, running], { [unmoved.identity!.root]: team.client, [running.identity!.root]: personal.client });
  const outcomes = await runUpdate({}, run.value);
  expect(outcomes.map(outcome => outcome.result)).toEqual(['not-moved', 'updated']);
  expect(team.requests).toEqual([]);
  expect(run.said.join('\n')).toContain(`hasn't moved to a release yet. To move it to this version and keep it running: ri start --root ${unmoved.identity!.root}`);
  expect(run.said.join('\n')).not.toContain('create your Home');
});

it('does not stop the other Homes when one refuses, and reports it', async () => {
  const stuck = home('stuck'); const next = home('next');
  const refusing: HomeClient = { ...controller('switches').client, request: async () => { throw new Error('Another update action is in progress'); } };
  const moving = controller('switches');
  const run = deps([stuck, next], { [stuck.identity!.root]: refusing, [next.identity!.root]: moving.client });
  const outcomes = await runUpdate({}, run.value);
  expect(outcomes.map(outcome => outcome.result)).toEqual(['failed', 'updated']);
  expect(run.said.join('\n')).toContain('update failed. Another update action is in progress');
});

it('keeps watching a Home acting on its update instead of calling it waiting', async () => {
  const personal = home('personal');
  let polls = 0;
  const acting: HomeClient = {
    status: async () => {
      polls++;
      const base = { protocol: 1, phase: 'running', release: { release: { build: polls > 3 ? NEW : OLD, version: '0.1.0', source: 'packaged' } } };
      return (polls > 3 ? { ...base, runId: 'run-2', update: { format: 1, phase: 'committed', changedAt: '' } }
        : { ...base, runId: 'run-1', update: { format: 1, phase: 'waiting', reason: 'Waiting for the service to be idle', busy: polls > 1, changedAt: '' } }) as unknown as HomeStatus;
    },
    request: async () => ({}) as never,
  };
  const run = deps([personal], { [personal.identity!.root]: acting });
  expect((await runUpdate({}, run.value))[0]).toMatchObject({ result: 'updated' });
});

it('says what it waits for once, whatever the Home calls it', async () => {
  const personal = home('personal');
  const waiting: HomeClient = {
    status: async () => ({ protocol: 1, runId: 'run-1', phase: 'running', release: { release: { build: OLD, version: '0.1.0', source: 'packaged' } }, update: { format: 1, phase: 'waiting', reason: 'Waiting for the maintenance window (UTC)', changedAt: '' } }) as unknown as HomeStatus,
    request: async () => ({}) as never,
  };
  const run = deps([personal], { [personal.identity!.root]: waiting });
  await runUpdate({}, run.value);
  expect(run.said.at(-1)).toContain(': waiting for the maintenance window (UTC). It switches');
});

it('tells a Home whose ri start did not finish to run it again, instead of failing', async () => {
  const halfway = { ...home('team'), active: NEW };
  const running = controller('switches');
  const run = deps([halfway], { [halfway.identity!.root]: running.client });
  expect((await runUpdate({}, run.value))[0]).toMatchObject({ result: 'not-moved' });
  expect(running.requests).toEqual([]);
  expect(run.said.join('\n')).toContain('ri start --root');
});

it('on published releases, one Home failing its download does not stop the others', async () => {
  const stuck = home('stuck'); const next = home('next'); const unmoved = { ...home('unmoved'), active: null };
  let phase = 'available';
  const client = (fails: boolean): HomeClient => ({
    status: async () => ({ protocol: 1, runId: 'run-1', phase: 'running', release: { release: { build: phase === 'done' ? NEW : OLD, version: '0.1.0', source: 'packaged' } },
      update: { format: 1, phase: fails ? 'failed' : 'ready', error: 'The download failed', configured: true, busy: false, changedAt: '', release: { version: '0.2.0', runtime: { id: NEW } } } }) as unknown as HomeStatus,
    request: async () => ({}) as never,
  });
  const run = deps([stuck, next, unmoved], { [stuck.identity!.root]: client(true), [next.identity!.root]: client(false), [unmoved.identity!.root]: client(false) }, { source: 'published', checkout: undefined });
  run.value.now = (() => { let t = 0; return () => (t += 400_000); })();
  const outcomes = await runUpdate({}, run.value);
  expect(outcomes.map(outcome => outcome.result)).toEqual(['not-moved', 'failed', 'pending']);
  expect(run.said.join('\n')).toContain('update failed. The download failed');
  expect(run.said.join('\n')).toContain("hasn't moved to a release yet");
  phase = 'done';
});

it('still tells an unmoved Home how to move when no published releases are set up', async () => {
  const unmoved = { ...home('team'), active: null };
  const run = deps([unmoved], { [unmoved.identity!.root]: controller('switches').client }, { source: 'published', checkout: undefined });
  expect((await runUpdate({}, run.value))[0]).toMatchObject({ result: 'not-moved' });
  expect(run.said.join('\n')).toContain('ri update --from <folder>');
  expect(run.said.join('\n')).toContain("hasn't moved to a release yet");
});

it("never tells a computer whose Ri predates its own record to run ri start", async () => {
  // Found live: a laptop running agents for a Home on a release from before
  // October 29 has a Home folder with no record, which `ri update` can't
  // switch. It used to print "Run `ri start` to create your Home", which on a
  // connected computer makes a second Home.
  const old: InstalledHome = { ...home('connected'), identity: null };
  const run = deps([old], {});
  expect(await runUpdate({}, run.value)).toEqual([]);
  const said = run.said.join('\n');
  expect(said).toContain('nothing was switched to it');
  expect(said).toContain("Don't run `ri start`");
  expect(said).not.toContain('Run `ri start` to create your Home');
});

it('still offers ri start on a computer with no Ri at all', async () => {
  const run = deps([], {});
  await runUpdate({}, run.value);
  expect(run.said.at(-1)).toContain('Run `ri start` to create your Home');
});
