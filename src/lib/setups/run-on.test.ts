/**
 * Where an agent's new executions run (docs/homes-spec.md §3.3, P3.1): the
 * choices, the saved and automatic defaults, and a start that names no
 * computer running on the default, or refused with the reason.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let hostId: string;
let laptopId: string;
let agentId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-run-on-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  hostId = identity.ensureHomeIdentity().home.hostComputerId!;
  const q = await import('@/lib/db/queries');
  q.updateComputer(hostId, { name: 'Mac Mini' });
  const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'MacBook', createdByApiKeyId: null });
  laptopId = q.redeemEnrollGrant({ secret: grant.secret, name: 'MacBook' }).computer.id;
  agentId = q.createWorkspace({ name: 'Ri', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
});

afterEach(async () => {
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

async function setUpOn(computerId: string, status: 'ready' | 'missing_folder' = 'ready') {
  const q = await import('@/lib/db/queries');
  q.recordAgentSetupReports(computerId, [{
    agentId, sourcePath: computerId === hostId ? home.root : '/Users/trey/code/ri', configRevision: null,
    status, problem: status === 'ready' ? null : 'The folder is gone.', references: [],
  }], { complete: true });
}

describe('the choices and the default', () => {
  it('runs an agent from before setups at home', async () => {
    const { runOnFor } = await import('./run-on');
    expect(runOnFor(agentId)).toMatchObject({
      choices: [{ computerId: hostId, name: 'Mac Mini', isHome: true, ready: true, connected: true }],
      savedDefaultId: null,
      defaultId: hostId,
    });
  });

  it('lists the home first, then the others as they were set up, and defaults to the home while it is usable', async () => {
    await setUpOn(hostId);
    await setUpOn(laptopId);
    const { runOnFor } = await import('./run-on');
    const runOn = runOnFor(agentId)!;
    expect(runOn.choices.map((c) => c.name)).toEqual(['Mac Mini', 'MacBook']);
    expect(runOn.choices[1]).toMatchObject({ ready: true, problem: null, connected: false });
    expect(runOn.defaultId).toBe(hostId);
  });

  it('defaults to the first computer set up for the agent when the home has no usable setup', async () => {
    await setUpOn(hostId, 'missing_folder');
    await setUpOn(laptopId);
    const { runOnFor } = await import('./run-on');
    const runOn = runOnFor(agentId)!;
    expect(runOn.choices[0]).toMatchObject({ isHome: true, ready: false, problem: "Ri's folder here isn't ready: The folder is gone." });
    expect(runOn.defaultId).toBe(laptopId);
  });

  it("says why a computer can't take work: not running agents, or the folder not ready", async () => {
    await setUpOn(hostId);
    await setUpOn(laptopId, 'missing_folder');
    const { runOnFor } = await import('./run-on');
    expect(runOnFor(agentId)!.choices[1]).toMatchObject({ ready: false, problem: "Ri's folder on MacBook isn't ready: The folder is gone." });

    const q = await import('@/lib/db/queries');
    const key = q.createApiKey({ name: 'Other CLI', deviceType: 'computer' });
    const other = q.registerComputerForApiKey({ apiKeyId: key.key.id, name: 'Old iMac', platform: 'darwin' }).computer.id;
    q.recordAgentSetupReports(other, [{ agentId, sourcePath: '/Users/trey/ri', configRevision: null, status: 'ready', problem: null, references: [] }], { complete: true });
    expect(runOnFor(agentId)!.choices.find((c) => c.computerId === other)).toMatchObject({
      ready: false,
      problem: "Old iMac isn't set up to run agents. Run `ri worker enroll` there first.",
    });
  });
});

describe('Make this the default', () => {
  it('saves a computer the agent is set up on, or the home, and clears back to the automatic choice', async () => {
    await setUpOn(hostId);
    await setUpOn(laptopId);
    const { runOnFor, setDefaultComputer } = await import('./run-on');
    expect(setDefaultComputer(agentId, laptopId)).toMatchObject({ savedDefaultId: laptopId, defaultId: laptopId });
    expect(setDefaultComputer(agentId, hostId)).toMatchObject({ savedDefaultId: hostId, defaultId: hostId });
    expect(setDefaultComputer(agentId, null)).toMatchObject({ savedDefaultId: null, defaultId: hostId });
    expect(runOnFor(agentId)!.savedDefaultId).toBeNull();
  });

  it('refuses a computer the agent is not set up on', async () => {
    await setUpOn(hostId);
    const { setDefaultComputer, RunOnError } = await import('./run-on');
    expect(() => setDefaultComputer(agentId, laptopId)).toThrow(RunOnError);
    expect(() => setDefaultComputer(agentId, laptopId)).toThrow("Ri isn't set up on MacBook. Attach its folder there first.");
  });

  it('keeps a saved default that stopped working as the default, with the reason, rather than picking another', async () => {
    await setUpOn(hostId);
    await setUpOn(laptopId);
    const { runOnFor, setDefaultComputer } = await import('./run-on');
    setDefaultComputer(agentId, laptopId);
    const q = await import('@/lib/db/queries');
    // The laptop reports it no longer has the agent.
    q.recordAgentSetupReports(laptopId, [], { complete: true });
    const runOn = runOnFor(agentId)!;
    expect(runOn.defaultId).toBe(laptopId);
    expect(runOn.choices.find((c) => c.computerId === laptopId)).toMatchObject({
      ready: false,
      problem: "Ri isn't set up on MacBook. Attach its folder there, or pick another computer.",
    });
  });
});

describe('a start that names no computer', () => {
  it('runs on the saved default, and a one-off choice runs where it says without changing the default', async () => {
    await setUpOn(hostId);
    await setUpOn(laptopId);
    const { setDefaultComputer } = await import('./run-on');
    setDefaultComputer(agentId, laptopId);
    const q = await import('@/lib/db/queries');
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');

    const onDefault = await dispatchExecutionSession({ workspaceId: agentId });
    expect(q.chatPlacement(onDefault.id)).toMatchObject({ computerId: laptopId, isHome: false });
    expect(q.listWorkerCommands(laptopId).filter((c) => c.kind === 'prepare')).toHaveLength(1);

    const oneOff = await dispatchExecutionSession({ workspaceId: agentId, computerId: hostId });
    expect(q.chatPlacement(oneOff.id)).toMatchObject({ computerId: hostId, isHome: true });
    expect(q.getWorkspace(agentId)?.defaultComputerId).toBe(laptopId);
  });

  it("is refused with the reason when the default can't take it, and nothing is created", async () => {
    await setUpOn(hostId);
    await setUpOn(laptopId);
    const { setDefaultComputer } = await import('./run-on');
    setDefaultComputer(agentId, laptopId);
    await setUpOn(laptopId, 'missing_folder');
    const q = await import('@/lib/db/queries');
    const { dispatchExecutionSession, ComputerUnavailableForDispatch } = await import('@/lib/sessions/dispatch');
    await expect(dispatchExecutionSession({ workspaceId: agentId })).rejects.toBeInstanceOf(ComputerUnavailableForDispatch);
    await expect(dispatchExecutionSession({ workspaceId: agentId })).rejects.toThrow("Ri's folder on MacBook isn't ready");
    expect(q.listChatSessions({ type: 'execution' })).toHaveLength(0);
  });

  it('runs at home with no saved default while the home is usable', async () => {
    await setUpOn(hostId);
    await setUpOn(laptopId);
    const q = await import('@/lib/db/queries');
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    const started = await dispatchExecutionSession({ workspaceId: agentId });
    expect(q.chatPlacement(started.id)).toMatchObject({ computerId: hostId, isHome: true });
  });
});

describe('where an execution runs, on the session', () => {
  it('names its computer, and the folder that computer prepared once it has', async () => {
    await setUpOn(hostId);
    await setUpOn(laptopId);
    const q = await import('@/lib/db/queries');
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    const home = await dispatchExecutionSession({ workspaceId: agentId, computerId: hostId });
    expect(q.getChatSessionWithExecution(home.id)?.location).toEqual({ computerId: hostId, name: 'Mac Mini', isHome: true, folder: null });

    const laptop = await dispatchExecutionSession({ workspaceId: agentId, computerId: laptopId });
    expect(laptop.location).toEqual({ computerId: laptopId, name: 'MacBook', isHome: false, folder: null });
    q.markPlacementPrepared(laptop.executionId!, 1, { worktreePath: '/Users/trey/wt/ri-1', branchName: 'ri/one', baseSha: 'abc', warning: null });
    expect(q.getChatSessionWithExecution(laptop.id)?.location?.folder).toBe('/Users/trey/wt/ri-1');
    // The execution's own worktree stays a home-only field.
    expect(q.getChatSessionWithExecution(laptop.id)?.worktreePath).toBeNull();
    expect(q.listRailSessions().find((s) => s.id === laptop.id)?.location?.name).toBe('MacBook');
  });
});

describe('the run-on route', () => {
  it('answers the choices, saves a default, and refuses one the agent is not set up on', async () => {
    await setUpOn(hostId);
    const { GET, PUT } = await import('@/app/api/workspaces/[id]/run-on/route');
    const params = Promise.resolve({ id: agentId });
    const got = await (await GET(new Request('http://x') as never, { params })).json();
    expect(got).toMatchObject({ defaultId: hostId, savedDefaultId: null });

    const put = (body: unknown) => PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: agentId }) });
    expect((await put({ defaultComputerId: laptopId })).status).toBe(400);
    await setUpOn(laptopId);
    const saved = await put({ defaultComputerId: laptopId });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ savedDefaultId: laptopId, defaultId: laptopId });
    expect((await put({ defaultComputerId: 42 })).status).toBe(400);
  });
});

