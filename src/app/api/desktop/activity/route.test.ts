import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RailSessionRow } from '@/lib/db/queries';
import { readDesktopActivity } from '@/lib/sessions/desktop-activity-contract';

const { sessions, running, pending } = vi.hoisted(() => ({ sessions: vi.fn(), running: vi.fn(), pending: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({ listRailSessions: sessions }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: running, listSessionsWithPending: pending }));
vi.mock('@/lib/auth/config-file', () => ({ readAuthConfig: () => ({ localToken: 'owner' }) }));
import { GET } from './route';

function session(id: string, over: Partial<RailSessionRow> = {}): RailSessionRow {
  return { id, status: 'active', surfaceKind: null, label: `Chat ${id}`, execution: null,
    lastOutcomeEventAt: null, unreadMarkerAt: null, lastViewedAt: null, lastActivityAt: null,
    startedAt: '2026-09-01 00:00:00', ...over } as RailSessionRow;
}
const request = (owner = 'owner', capability = 'private-desktop-capability') => new NextRequest('https://localhost/api/desktop/activity', {
  headers: { authorization: `Bearer ${owner}`, 'x-ri-desktop-client': capability },
});
beforeEach(() => {
  vi.stubEnv('RI_DESKTOP_CLIENT_SECRET', 'private-desktop-capability');
  sessions.mockReset().mockReturnValue([]); running.mockReset().mockReturnValue([]); pending.mockReset().mockReturnValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe('owner desktop activity API', () => {
  it.each([['', ''], ['owner', ''], ['phone', 'private-desktop-capability'], ['owner', 'wrong']])('requires both owner and native capability (%s, %s)', (owner, capability) => {
    expect(GET(request(owner, capability)).status).toBe(403);
    expect(sessions).not.toHaveBeenCalled(); expect(running).not.toHaveBeenCalled(); expect(pending).not.toHaveBeenCalled();
  });

  it('uses mutually exclusive rail state with input priority over running and unread', async () => {
    const unread = { lastOutcomeEventAt: '2026-09-26T00:00:00Z' };
    sessions.mockReturnValue([session('input', unread), session('running', unread), session('unread', unread),
      session('waiting'), session('settled-import', { surfaceKind: 'imported_agent' }), session('archived', { status: 'archived' })]);
    running.mockReturnValue(['input', 'running', 'archived', 'main-chat']);
    pending.mockReturnValue(['input', 'archived', 'main-chat']);
    const response = GET(request());
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = readDesktopActivity(await response.json());
    expect(body).toEqual({ running: 1, needsInput: 1, unread: 1, attention: 2,
      targets: [
        { sessionId: 'input', label: 'Chat input', state: 'needsInput' },
        { sessionId: 'unread', label: 'Chat unread', state: 'unread' },
        { sessionId: 'running', label: 'Chat running', state: 'running' },
      ] });
  });

  it('bounds destinations while keeping complete counts, with input before unread and newest first', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => session(`s${i}`, { startedAt: `2026-09-${String(i + 1).padStart(2, '0')} 00:00:00` }));
    sessions.mockReturnValue(rows); pending.mockReturnValue(rows.map(row => row.id));
    const body = readDesktopActivity(await GET(request()).json());
    expect(body.attention).toBe(12); expect(body.needsInput).toBe(12);
    expect(body.targets.map(target => target.sessionId)).toEqual(['s11', 's10', 's9', 's8', 's7']);
  });

  it('uses execution labels and sends no prompt, transcript, attachment, path or takeover secret', async () => {
    sessions.mockReturnValue([session('private', {
      label: 'Fallback chat title', scratchPad: 'private body', externalTranscriptPath: '/private/transcript',
      execution: { label: '\nExecution\u202e title' + 'x'.repeat(150), takeoverToken: 'never-send-this', worktreePath: '/private/worktree' },
    } as unknown as Partial<RailSessionRow>)]);
    pending.mockReturnValue(['private']);
    const body = readDesktopActivity(await GET(request()).json());
    expect(body.targets[0]).toEqual({ sessionId: 'private', state: 'needsInput', label: ('Execution  title' + 'x'.repeat(150)).slice(0, 100) });
    expect(JSON.stringify(body)).not.toMatch(/private body|transcript|never-send-this|worktree|Fallback chat/);
  });

  it('returns unavailable without leaking errors when the service cannot read activity', async () => {
    sessions.mockImplementation(() => { throw new Error('/private/database details'); });
    const response = GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Desktop activity is temporarily unavailable.' });
  });
});
