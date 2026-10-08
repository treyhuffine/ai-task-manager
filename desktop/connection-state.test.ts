import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopConnection } from './connection-state';
import { connectionFailure } from './connection-failure';
import { HomeRequestError } from '../src/lib/connection/home-client';
import { DesktopSessionError } from './session-auth';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const network = connectionFailure(new HomeRequestError('unreachable', 'The request timed out.'));
function fixture(viewer = false) {
  const deps = { hasViewer: () => viewer, publish: vi.fn(), startup: vi.fn() };
  return { ...deps, connection: new DesktopConnection(deps) };
}

it('keeps brief startup failures quiet and cancels the delayed recovery screen on success', () => {
  const f = fixture();
  f.connection.begin(); f.connection.failed(network);
  vi.advanceTimersByTime(9_999);
  expect(f.startup).not.toHaveBeenCalled();
  expect(f.connection.snapshot().showNotice).toBe(false);
  f.connection.connected(); vi.advanceTimersByTime(10_000);
  expect(f.startup).not.toHaveBeenCalled();
  expect(f.connection.snapshot()).toEqual({ phase: 'connected', issue: null, showNotice: false });
});

it('offers recovery after ten seconds even when the initial request is still pending', () => {
  const f = fixture(); f.connection.begin();
  vi.advanceTimersByTime(10_000);
  expect(f.startup).toHaveBeenCalledOnce();
  expect(f.connection.snapshot()).toMatchObject({ phase: 'connecting', showNotice: true });
});

it('never covers an accepted viewer, even through long outages, sign-in failures and retries', () => {
  const f = fixture(true); f.connection.connected(); f.connection.failed(network);
  vi.advanceTimersByTime(10_000);
  expect(f.connection.snapshot().showNotice).toBe(true);
  f.connection.failed(connectionFailure(new HomeRequestError('unauthorized', 'Access removed.')));
  f.connection.begin(); vi.advanceTimersByTime(60_000);
  f.connection.connected();
  expect(f.startup).not.toHaveBeenCalled();
  expect(f.connection.snapshot()).toMatchObject({ phase: 'connected', issue: null, showNotice: false });
  f.connection.failed(network); vi.advanceTimersByTime(9_999);
  expect(f.connection.snapshot().showNotice).toBe(false);
});

it('does not extend the grace period for repeated failures or leave timers after shutdown', () => {
  const f = fixture(); f.connection.begin();
  vi.advanceTimersByTime(5_000); f.connection.failed(network);
  vi.advanceTimersByTime(5_000);
  expect(f.connection.snapshot().showNotice).toBe(true);
  f.connection.connected(); f.connection.begin(); f.connection.stop();
  f.startup.mockClear(); vi.advanceTimersByTime(20_000);
  expect(f.startup).not.toHaveBeenCalled();
});

it.each([
  [new HomeRequestError('unauthorized', 'Access removed.'), 'sign_in'],
  [new DesktopSessionError('Credential rejected.', 'credential', 401), 'sign_in'],
  [new HomeRequestError('untrusted_certificate', 'Certificate expired.'), 'certificate'],
  [new HomeRequestError('wrong_home', 'This is another Home.'), 'attention'],
  [new Error('The local service stopped.'), 'attention'],
])('shows actionable startup failures immediately with their real detail: %s', (error, kind) => {
  const f = fixture(); f.connection.begin();
  const issue = connectionFailure(error); f.connection.failed(issue);
  expect(issue).toMatchObject({ kind, retryable: false, detail: error.message });
  expect(f.startup).toHaveBeenCalledOnce();
  expect(issue.message).not.toMatch(/awake|asleep|unreachable/);
});

it.each(['timeout', 'network', 'server'] as const)('allows quiet automatic recovery from session %s failures', code => {
  expect(connectionFailure(new DesktopSessionError('Temporary failure.', code))).toMatchObject({ kind: 'network', retryable: true });
});

it('routes a rejected local service credential to local settings instead of remote pairing', () => {
  expect(connectionFailure(new DesktopSessionError('Restart the local service.', 'credential', 401), true))
    .toMatchObject({ kind: 'attention', message: 'The local Ri service needs attention.', retryable: false });
});

it('starts a fresh grace period after first-run setup finishes', () => {
  const f = fixture(); f.connection.begin(); f.connection.reset();
  vi.advanceTimersByTime(60_000); f.connection.begin();
  expect(f.startup).not.toHaveBeenCalled();
  vi.advanceTimersByTime(9_999);
  expect(f.connection.snapshot().showNotice).toBe(false);
  f.connection.stop();
});

it.each(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE'])('keeps local service transport failure %s quiet too', code => {
  expect(connectionFailure(Object.assign(new Error('Local request failed.'), { code })))
    .toMatchObject({ kind: 'network', retryable: true });
});
