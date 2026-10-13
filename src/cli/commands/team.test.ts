import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { ensureHomeIdentity } from '@/lib/home/identity';
import { readTeamIntent, teamIntentPath } from '@/lib/home/team-intent';
import { createTeamOwner, getHome, inspectTeamGrant, listMembers, memberForApiKey, revokeApiKey, teamHasOwner } from '@/lib/db/queries';
import { finishSetup, signIn } from '@/lib/team/admission';

const mocks = vi.hoisted(() => ({
  start: vi.fn(), open: vi.fn(), confirm: vi.fn(), inspectTrust: vi.fn(), installTrust: vi.fn(),
}));
vi.mock('./service', () => ({ startBackgroundService: mocks.start }));
vi.mock('../lib/browser', () => ({ openBrowser: mocks.open }));
vi.mock('@clack/prompts', () => ({ confirm: mocks.confirm, isCancel: (v: unknown) => typeof v === 'symbol' }));
vi.mock('@/lib/config/tls-trust', () => ({ inspectTrust: mocks.inspectTrust, installTrust: mocks.installTrust }));
import { registerTeamCommand } from './team';

let home: TestHome;
let previousExitCode: typeof process.exitCode;
let ttyDescriptor: PropertyDescriptor | undefined;
const origin = 'https://localhost:43333';

async function readyService() {
  expect(readTeamIntent()?.kind).toBe('team');
  ensureHomeIdentity();
  return { origin };
}

beforeEach(async () => {
  vi.clearAllMocks();
  home = await createTestHome({ prefix: 'ri-team-create-', openDb: false });
  vi.stubEnv('RI_PUBLIC_BASE_URL', origin);
  previousExitCode = process.exitCode;
  process.exitCode = 0;
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.start.mockImplementation(readyService);
  mocks.confirm.mockResolvedValue(true);
  mocks.inspectTrust.mockReturnValue({ detected: [{ target: 'macos-system' }], recorded: [], caCertPath: '/fixture/ca.crt' });
  mocks.installTrust.mockResolvedValue({ results: [{ target: 'macos-system', outcome: 'installed' }] });
});

afterEach(async () => {
  process.exitCode = previousExitCode;
  if (ttyDescriptor) Object.defineProperty(process.stdin, 'isTTY', ttyDescriptor);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await home.cleanup();
});

function runTeam(...args: string[]) {
  const program = new Command().exitOverride();
  registerTeamCommand(program);
  return program.parseAsync(['node', 'ri', 'team', ...args]);
}

function create(...args: string[]) {
  return runTeam('create', '--root', home.root, '--name', 'Acme', ...args);
}

it('creates without a CLI name and accepts the team and owner names in browser setup', async () => {
  await runTeam('create', '--root', home.root);
  expect(process.exitCode).toBe(0);
  expect(getHome()).toMatchObject({ kind: 'team', name: 'Team' });
  const secret = new URLSearchParams(new URL(mocks.open.mock.calls[0][0]).hash.slice(1)).get('setup')!;
  const admitted = finishSetup({ secret, teamName: 'Team Huffine', ownerName: 'Trey' }, null);
  expect(admitted.member).toMatchObject({ name: 'Trey', role: 'owner' });
  expect(getHome()?.name).toBe('Team Huffine');
  await runTeam('create', '--root', home.root);
  expect(mocks.open).toHaveBeenLastCalledWith(origin);
  expect(getHome()?.name).toBe('Team Huffine');
  expect(listMembers()).toHaveLength(1);
});

it('recovers the same owner from the host after the only browser sign-in is revoked', async () => {
  await create('--no-open');
  const owner = createTeamOwner({ creationId: readTeamIntent()!.creationId, name: 'Trey', device: { name: 'Original browser', kind: 'computer' } });
  revokeApiKey(owner.key.id);
  expect(memberForApiKey(owner.key.id)).toBeNull();
  expect(teamHasOwner()).toBe(true);
  vi.mocked(console.log).mockClear();
  await runTeam('owner-sign-in');
  const link = vi.mocked(console.log).mock.calls.map(([value]) => value).find((value) => String(value).startsWith(`${origin}/join#sign-in=`));
  expect(link).toBeDefined();
  const secret = new URLSearchParams(new URL(String(link)).hash.slice(1)).get('sign-in')!;
  const recovered = signIn({ secret }, null);
  expect(recovered.member).toMatchObject({ id: owner.member.id, name: 'Trey', role: 'owner' });
  expect(recovered.token).not.toBe(owner.token.plaintext);
  expect(listMembers()).toHaveLength(1);
  expect(inspectTeamGrant(secret, 'sign_in').state).toBe('used');
});

it('creates and starts the team, offers certificate trust and opens a real owner setup grant', async () => {
  await create();
  expect(process.exitCode).toBe(0);
  expect(getHome()).toMatchObject({ kind: 'team', name: 'Acme' });
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(mocks.installTrust).toHaveBeenCalledOnce();
  expect(mocks.open).toHaveBeenCalledOnce();
  const link = new URL(mocks.open.mock.calls[0][0]);
  expect(link.origin).toBe(origin);
  expect(inspectTeamGrant(new URLSearchParams(link.hash.slice(1)).get('setup')!, 'setup').state).toBe('valid');
  expect(teamHasOwner()).toBe(false);
});

it('prints a setup link without opening a browser or installing trust when --no-open is given', async () => {
  await create('--no-open');
  expect(getHome()?.kind).toBe('team');
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`${origin}/join#setup=`));
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(mocks.installTrust).not.toHaveBeenCalled();
});

it('retains the provision-only operation and resumes it with the same command', async () => {
  await create('--no-start');
  const intent = readTeamIntent();
  expect(fs.existsSync(home.dbPath)).toBe(false);
  expect(mocks.start).not.toHaveBeenCalled();
  await create('--no-open');
  const id = getHome()?.id;
  await create('--no-open');
  expect(readTeamIntent()).toEqual(intent);
  expect(getHome()?.id).toBe(id);
  expect(mocks.start).toHaveBeenCalledTimes(2);
});

it('resumes after a service startup failure without replacing its team declaration', async () => {
  mocks.start.mockRejectedValueOnce(new Error('Temporary startup failure'));
  await create('--no-open');
  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Temporary startup failure'));
  const intent = readTeamIntent();
  expect(fs.existsSync(home.dbPath)).toBe(false);
  process.exitCode = 0;
  await create('--no-open');
  expect(process.exitCode).toBe(0);
  expect(readTeamIntent()).toEqual(intent);
  expect(getHome()?.kind).toBe('team');
});

it('opens an already configured team without offering to create another owner', async () => {
  await create('--no-open');
  createTeamOwner({ creationId: readTeamIntent()!.creationId, name: 'Owner', device: { name: 'Test', kind: 'computer' } });
  mocks.inspectTrust.mockReturnValue({ detected: [{ target: 'macos-system' }], recorded: ['macos-system'], caCertPath: '/fixture/ca.crt' });
  await create();
  expect(mocks.open).toHaveBeenCalledWith(origin);
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(mocks.installTrust).not.toHaveBeenCalled();
});

it('does not convert or start a personal home', async () => {
  const personal = ensureHomeIdentity().home;
  await create();
  expect(process.exitCode).toBe(1);
  expect(getHome()).toEqual(personal);
  expect(readTeamIntent()).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
});

it('does not turn a connected installation into a team', async () => {
  fs.writeFileSync(path.join(home.configDir, 'connection.json'), '{}');
  await create();
  expect(process.exitCode).toBe(1);
  expect(readTeamIntent()).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
  expect(fs.existsSync(home.dbPath)).toBe(false);
});

it('refuses a damaged declaration without starting anything', async () => {
  fs.writeFileSync(teamIntentPath(), '{bad', { mode: 0o600 });
  await create();
  expect(process.exitCode).toBe(1);
  expect(mocks.start).not.toHaveBeenCalled();
  expect(fs.existsSync(home.dbPath)).toBe(false);
});

it.each([false, Symbol('canceled')])('opens setup without installing trust when certificate consent is skipped: %s', async (answer) => {
  mocks.confirm.mockResolvedValue(answer);
  await create();
  expect(process.exitCode).toBe(0);
  expect(getHome()?.kind).toBe('team');
  expect(mocks.installTrust).not.toHaveBeenCalled();
  expect(mocks.open).toHaveBeenCalledWith(expect.stringContaining(`${origin}/join#setup=`));
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('certificate warning'));
});

it('never changes native trust implicitly in a noninteractive shell', async () => {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
  await create();
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(mocks.installTrust).not.toHaveBeenCalled();
  expect(mocks.open).toHaveBeenCalledOnce();
  await create('--trust-local');
  expect(mocks.installTrust).toHaveBeenCalledOnce();
  expect(mocks.open).toHaveBeenCalledTimes(2);
});

it('allows owner setup after a certificate failure and retries trust on the same team', async () => {
  mocks.installTrust.mockResolvedValue({ results: [{ label: 'System trust', outcome: 'permission-denied' }] });
  await create();
  expect(process.exitCode).toBe(0);
  expect(mocks.open).toHaveBeenCalledOnce();
  expect(getHome()?.kind).toBe('team');
  expect(teamHasOwner()).toBe(false);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Continuing in your browser'));
  const link = new URL(mocks.open.mock.calls[0][0]);
  const secret = new URLSearchParams(link.hash.slice(1)).get('setup')!;
  expect(inspectTeamGrant(secret, 'setup').state).toBe('valid');
  const admitted = finishSetup({ secret, teamName: 'Acme', ownerName: 'Owner' }, null);
  expect(admitted.member.role).toBe('owner');
  expect(teamHasOwner()).toBe(true);
  const id = getHome()?.id;
  mocks.installTrust.mockResolvedValue({ results: [{ label: 'System trust', outcome: 'installed' }] });
  await create();
  expect(getHome()?.id).toBe(id);
  expect(process.exitCode).toBe(0);
  expect(mocks.open).toHaveBeenLastCalledWith(origin);
});

it.each(['install', 'inspect'])('opens setup even when certificate %s throws unexpectedly', async (step) => {
  if (step === 'install') mocks.installTrust.mockRejectedValueOnce(new Error('Certificate storage unavailable'));
  else mocks.inspectTrust.mockImplementationOnce(() => { throw new Error('Certificate storage unavailable'); });
  await create();
  expect(process.exitCode).toBe(0);
  expect(mocks.open).toHaveBeenCalledWith(expect.stringContaining(`${origin}/join#setup=`));
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Certificate storage unavailable'));
});

it.each(['missing-tool', 'unsupported', 'error'])('opens setup when certificate installation reports %s', async (outcome) => {
  mocks.installTrust.mockResolvedValue({ results: [{ label: 'System trust', outcome }] });
  await create();
  expect(process.exitCode).toBe(0);
  expect(mocks.open).toHaveBeenCalledWith(expect.stringContaining(`${origin}/join#setup=`));
});

it('still reports a browser launch failure and leaves the setup link available', async () => {
  mocks.open.mockRejectedValueOnce(new Error('No browser available'));
  await create();
  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No browser available'));
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`${origin}/join#setup=`));
});

it('reports an optional browser trust failure without blocking a successfully configured system browser', async () => {
  mocks.installTrust.mockResolvedValue({ results: [
    { label: 'System trust', outcome: 'installed' },
    { label: 'Firefox', outcome: 'missing-tool' },
  ] });
  await create();
  expect(process.exitCode).toBe(0);
  expect(console.error).toHaveBeenCalledWith('Firefox: missing-tool');
  expect(mocks.open).toHaveBeenCalledOnce();
});
