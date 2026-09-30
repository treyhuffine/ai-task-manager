import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * The Connect card's buttons land here, and only a person should be able to press them: the route
 * refuses agent-credentialed calls, validates the action, and maps request errors to statuses.
 */

const h = vi.hoisted(() => {
  class ConnectionRequestError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    ConnectionRequestError,
    startCardSignIn: vi.fn(),
    connectCardWithKey: vi.fn(),
    allowCardForAgent: vi.fn(),
    declineCard: vi.fn(),
  };
});
vi.mock('@/lib/connectors/connection-requests', () => h);

import { POST } from './route';

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost/api/connectors/requests/ev-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ eventId: 'ev-1' }) },
  );
}

beforeEach(() => {
  for (const fn of [h.startCardSignIn, h.connectCardWithKey, h.allowCardForAgent, h.declineCard]) fn.mockReset();
});

describe('POST /api/connectors/requests/[eventId]', () => {
  it('refuses a request carrying an agent session credential', async () => {
    const res = await post({ action: 'allow' }, { 'x-ri-session': 'chat-1.sig' });
    expect(res.status).toBe(403);
    expect(h.allowCardForAgent).not.toHaveBeenCalled();
  });

  it('validates the action and requires key fields', async () => {
    expect((await post({ action: 'approve' })).status).toBe(400);
    expect((await post({ action: 'key', fields: { token: '  ' } })).status).toBe(400);
    expect(h.connectCardWithKey).not.toHaveBeenCalled();
  });

  it('starts a sign-in with a same-origin return path only', async () => {
    h.startCardSignIn.mockResolvedValue({ requestId: 'a', authorizationUrl: 'https://accounts.example' });
    const res = await post({ action: 'sign_in', returnTo: '/?session=chat-1' });
    expect(await res.json()).toEqual({ requestId: 'a', authorizationUrl: 'https://accounts.example' });
    expect(h.startCardSignIn.mock.calls[0]!.slice(1)).toEqual(['ev-1', '/?session=chat-1']);
    await post({ action: 'sign_in', returnTo: 'https://evil.example' });
    expect(h.startCardSignIn.mock.calls[1]![2]).toBeNull();
  });

  it('passes trimmed-out key fields through and answers the other actions', async () => {
    await post({ action: 'key', fields: { token: 'tok', empty: '', n: 3 } });
    expect(h.connectCardWithKey).toHaveBeenCalledWith('ev-1', { token: 'tok' });
    expect((await post({ action: 'allow' })).status).toBe(200);
    expect((await post({ action: 'decline' })).status).toBe(200);
  });

  it('maps request errors to statuses', async () => {
    h.declineCard.mockRejectedValueOnce(new h.ConnectionRequestError('not_found', 'gone'));
    expect((await post({ action: 'decline' })).status).toBe(404);
    h.declineCard.mockRejectedValueOnce(new h.ConnectionRequestError('already_answered', 'done'));
    expect((await post({ action: 'decline' })).status).toBe(409);
  });
});
