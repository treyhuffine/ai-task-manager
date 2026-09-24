import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetConnectivity,
  getConnectivity,
  isNetworkFailure,
  reportNetworkFailure,
  reportReachable,
  subscribeConnectivity,
} from './connectivity';

/** One dropped request isn't an outage: the home is unreachable only when health fails too. */

beforeEach(() => _resetConnectivity());
afterEach(() => vi.unstubAllGlobals());

describe('connectivity', () => {
  it('stays reachable when a request fails but the home answers health', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, app: 'ri' })));
    await reportNetworkFailure();
    expect(getConnectivity().reachable).toBe(true);
  });

  it('goes unreachable when health fails too, and back on any answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const seen: boolean[] = [];
    const off = subscribeConnectivity(() => seen.push(getConnectivity().reachable));
    await reportNetworkFailure();
    expect(getConnectivity()).toMatchObject({ reachable: false, since: expect.any(Number) });
    reportReachable();
    expect(getConnectivity().reachable).toBe(true);
    expect(seen).toEqual([false, true]);
    off();
  });

  it("doesn't believe a tunnel's page that isn't Ri", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Tunnel is up, origin is down</html>', { status: 200 })));
    await reportNetworkFailure();
    expect(getConnectivity().reachable).toBe(false);
  });

  it('counts only network failures, not aborts', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFailure(new DOMException('aborted', 'AbortError'))).toBe(false);
  });
});
