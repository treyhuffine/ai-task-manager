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
import { beamdOpen, beamdClose, beamdList, BeamdCliError, setBeamdBinOverride } from '../beamd/cli';
import { beamdConfigExists } from '../beamd/config';
import { readPreviewSettings } from '../settings';

export const beamdProvider: PreviewProvider = {
  id: 'beamd',
  label: 'Beam (self-hosted tunnel)',
  kind: 'dynamic',
  managesLocalServer: true,

  async resolve(ctx) {
    if (!beamdConfigExists()) {
      throw new PreviewProviderError(
        'beamd_not_configured',
        'Beam is selected but not configured.',
        'Add your beamd server and token in preview settings.',
      );
    }
    // Honor a configured binary path (local/unpublished builds).
    setBeamdBinOverride(readPreviewSettings().beamdBinPath);

    const name = ctx.previewName;
    try {
      // Reuse a live tunnel if one already exists for this name (idempotent
      // bring-up across resolves and network blips).
      const existing = (await beamdList()).find((t) => t.name === name);
      if (existing?.url) {
        return { url: existing.url, stop: () => closeQuietly(name) };
      }
      const opened = await beamdOpen(ctx.port, name);
      return { url: opened.url, stop: () => closeQuietly(name) };
    } catch (err) {
      if (err instanceof BeamdCliError) {
        throw new PreviewProviderError(err.code, err.message);
      }
      throw err;
    }
  },

  isConfigured() {
    return beamdConfigExists();
  },
};

async function closeQuietly(name: string): Promise<void> {
  try {
    await beamdClose(name);
  } catch {
    // Tear-down is best-effort; a dangling tunnel self-expires and `close`
    // is idempotent on the next attempt.
  }
}
