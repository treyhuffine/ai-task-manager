/**
 * Boot-managed "keep Flow reachable" tunnel.
 *
 * Flow's own beamd tunnel was only ever opened by a manual click in settings.
 * On a headless remote box that's a chicken-and-egg: you need the tunnel to
 * reach the UI that opens the tunnel. When the user opts in (`autoTunnel` in
 * config.json) we open the app tunnel at boot and re-open it whenever it drops
 * — so the machine is reachable across restarts, reboots, and network blips
 * without ever touching the UI.
 *
 * Discipline (mirrors the preview idle-evict loop):
 *   - Opt-in AND beamd-auth gated. No opt-in → the loop idles.
 *   - Entirely fire-and-forget. A tunnel problem never blocks or crashes boot.
 *   - The beamd tunnel name is stable and `beamdOpen` is idempotent, so a
 *     re-open returns the SAME URL — paired laptops/phones keep working.
 *   - `.unref()`'d timer so it never holds the process open.
 */

import { getAutoTunnel } from '@/lib/auth/bootstrap';
import { getRunningPort, DEFAULT_PORT, DEV_PORT } from '@/lib/auth/port';
import { appBeamdTunnelName, openAndSaveBeamdBaseUrl } from '@/lib/auth/beamd-base-url';
import { beamdConnectedServer, beamdList } from '@/lib/preview/beamd/cli';

const KEEPALIVE_MS = 60_000;
let started = false;

/**
 * The port Flow is actually listening on at boot. Mirrors the base-url route:
 * explicit PORT env wins, else the persisted running port, else the
 * env-appropriate default. (No request URL to consult at boot.)
 */
function resolvePort(): number {
  const envPort = Number(process.env.PORT);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  const fallback = process.env.NODE_ENV === 'development' ? DEV_PORT : DEFAULT_PORT;
  return getRunningPort(fallback);
}

/** Is the app's own beamd tunnel currently live and healthy? */
async function tunnelIsHealthy(): Promise<boolean> {
  const name = appBeamdTunnelName();
  try {
    const entry = (await beamdList()).find((t) => t.name === name);
    return !!entry?.healthy;
  } catch {
    return false;
  }
}

/**
 * Open the app tunnel if opted-in and beamd is logged in. Safe to call
 * repeatedly — a no-op when the flag is off, a clear log when beamd isn't
 * connected, an idempotent re-open otherwise.
 */
async function ensureTunnelUp(): Promise<void> {
  if (!getAutoTunnel()) return;
  const server = await beamdConnectedServer().catch(() => null);
  if (!server) {
    console.warn(
      '[auto-tunnel] enabled but beamd is not connected on this machine — skipping. Connect Beamd in settings or run `beamd login`.',
    );
    return;
  }
  const { url } = await openAndSaveBeamdBaseUrl(resolvePort());
  console.log(`[auto-tunnel] Flow reachable at ${url}`);
}

/**
 * Start the boot open + keep-alive loop. Idempotent per process. The timer
 * always runs (cheap, unref'd) so a runtime toggle-on is picked up without a
 * restart; each tick is gated on the opt-in flag.
 */
export function startAutoTunnel(): void {
  if (started) return;
  started = true;

  // Immediate bring-up when already opted in at boot (no-op otherwise).
  void ensureTunnelUp().catch((err) => console.warn('[auto-tunnel] initial open failed', err));

  const interval = setInterval(() => {
    if (!getAutoTunnel()) return;
    void (async () => {
      if (await tunnelIsHealthy()) return;
      await ensureTunnelUp().catch((err) => console.warn('[auto-tunnel] reopen failed', err));
    })();
  }, KEEPALIVE_MS);
  interval.unref?.();
}
