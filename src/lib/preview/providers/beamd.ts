/**
 * BeamdProvider — the first-class remote provider. Drives the bundled
 * `beamd` binary to expose the worktree's dev server as an HTTPS URL with a
 * real cert, reachable from any device.
 *
 * `resolve()` is the tunnel half of lazy bring-up (the server half is done
 * by the orchestrator before this runs, since `managesLocalServer` is true):
 *   1. Is a tunnel for this name already live? (`beamd list`) → reuse its URL.
 *   2. Else open one (`beamd open <port> --as <name> -d --json`).
 * The `url` is read straight from beamd — never assembled — so it's correct
 * whether the edge is flat (`<name>.<base>`) or namespaced
 * (`<name>.<slug>.<base>`). `stop()` closes the tunnel; the name stays
 * reserved so the next `resolve()` cold-starts the same URL.
 */

import type { PreviewProvider } from './types';
import { PreviewProviderError } from './types';
import { beamdOpen, beamdClose, beamdList, beamdConnectedServer, BeamdCliError } from '../beamd/cli';

export const beamdProvider: PreviewProvider = {
  id: 'beamd',
  label: 'Beamd',
  kind: 'dynamic',
  managesLocalServer: true,

  async resolve(ctx) {
    const name = ctx.previewName;
    // Run beamd from the worktree so it resolves the project's `beamd.yaml`
    // (edge + scope) — the tunnel lands where the project wants. list/close
    // use the same cwd so reuse + teardown hit that same scope.
    const cwd = ctx.cwd;
    try {
      // Reuse a live tunnel if one already exists for this name (idempotent
      // bring-up across resolves and network blips).
      const existing = (await beamdList({ cwd })).find((t) => t.name === name);
      if (existing?.url) {
        return { url: existing.url, stop: () => closeQuietly(name, cwd) };
      }
      const opened = await beamdOpen(ctx.port, name, { cwd });
      return { url: opened.url, stop: () => closeQuietly(name, cwd) };
    } catch (err) {
      if (err instanceof BeamdCliError) {
        // Not-connected is the common first-run case — surface the connect CTA.
        const code = err.code === 'beamd_not_connected' || err.code === 'beamd_unauthorized'
          ? 'beamd_not_configured'
          : err.code;
        throw new PreviewProviderError(code, err.message);
      }
      throw err;
    }
  },

  async isConfigured() {
    return (await beamdConnectedServer()) !== null;
  },
};

async function closeQuietly(name: string, cwd?: string): Promise<void> {
  try {
    await beamdClose(name, { cwd });
  } catch {
    // Tear-down is best-effort; a dangling tunnel self-expires and `close`
    // is idempotent on the next attempt.
  }
}
