import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER, MEMBER_ROLE_HEADER } from '@/lib/auth/request-key';

const mocks = vi.hoisted(() => ({ owner: vi.fn(() => false), team: vi.fn(() => false), teamDefault: vi.fn(() => false) }));
vi.mock('./owner-auth', () => ({ isInstallationOwner: mocks.owner }));
vi.mock('@/lib/home/authority', () => ({ isTeamAuthority: mocks.team }));
vi.mock('./home-lookup', () => ({ isDefaultHomeTeam: mocks.teamDefault }));
const { mayRunUpdateAction, updateRights, visibleServiceStatus } = await import('./update-rights');

beforeEach(() => { mocks.owner.mockReturnValue(false); mocks.team.mockReturnValue(false); mocks.teamDefault.mockReturnValue(false); });
const request = (scope?: string, role?: string) => ({ headers: new Headers({ ...(scope ? { [API_KEY_ID_HEADER]: 'key', [API_KEY_SCOPE_HEADER]: scope } : {}), ...(role ? { [MEMBER_ROLE_HEADER]: role } : {}) }) });

it('gives this computer\'s own key everything', () => {
  mocks.owner.mockReturnValue(true);
  expect(updateRights(request())).toEqual({ manage: true, use: true });
});

it('lets the personal Home owner\'s paired devices use updates but not manage them', () => {
  expect(updateRights(request('viewer'))).toEqual({ manage: false, use: true });
});

it.each(['worker', 'session', 'ai_client', 'app_client', 'team_ai'])('refuses a %s key', scope => {
  expect(updateRights(request(scope))).toEqual({ manage: false, use: false });
});

it('refuses a request with no key', () => {
  expect(updateRights(request())).toEqual({ manage: false, use: false });
});

it('shows a team the state but changes nothing when the computer also runs a personal Home', () => {
  mocks.team.mockReturnValue(true);
  expect(updateRights(request('member', 'owner'))).toEqual({ manage: false, use: false });
});

it('lets a team server\'s owner use updates, and never a member', () => {
  mocks.team.mockReturnValue(true);
  mocks.teamDefault.mockReturnValue(true);
  expect(updateRights(request('member', 'owner'))).toEqual({ manage: false, use: true });
  expect(updateRights(request('member', 'member'))).toEqual({ manage: false, use: false });
});

it('keeps channel, download, rollback and offers with the computer\'s own key', () => {
  const device = { manage: false, use: true };
  for (const action of ['apply', 'apply-now', 'later'] as const) expect(mayRunUpdateAction(device, action)).toBe(true);
  for (const action of ['check', 'download', 'when-idle', 'offer', 'rollback'] as const) expect(mayRunUpdateAction(device, action)).toBe(false);
  expect(mayRunUpdateAction({ manage: true, use: true }, 'rollback')).toBe(true);
  expect(mayRunUpdateAction({ manage: false, use: false }, 'apply')).toBe(false);
});

describe('what a caller sees of the service', () => {
  const status = { phase: 'running', version: '0.2.0', error: 'a stack from /Users/owner/ri', repo: '/Users/owner/release', node: '/Users/owner/node', origin: 'https://localhost:1',
    update: { phase: 'waiting', error: 'details', checkpoint: '/Users/owner/snapshot', local: { checkout: '/Users/owner/code' }, origin: { source: 'checkout', checkout: '/Users/owner/code' }, reason: 'a quiet moment' } } as never;
  it('shows this computer\'s own key everything', () => {
    expect(visibleServiceStatus(status, { manage: true, use: true })).toBe(status);
  });
  it('keeps local errors from a paired device', () => {
    expect(visibleServiceStatus(status, { manage: false, use: true })).toMatchObject({ repo: '/Users/owner/release', error: expect.stringContaining('local recovery window'), update: { error: expect.stringContaining('local recovery window') } });
  });
  it('gives a team\'s people the update state and nothing about the computer', () => {
    mocks.team.mockReturnValue(true);
    const seen = JSON.stringify(visibleServiceStatus(status, { manage: false, use: false }));
    expect(seen).not.toContain('/Users/owner');
    expect(JSON.parse(seen)).toMatchObject({ phase: 'running', version: '0.2.0', update: { phase: 'waiting', reason: 'a quiet moment', origin: { source: 'checkout' } } });
    expect(JSON.parse(seen).origin).toBeUndefined();
  });
});

