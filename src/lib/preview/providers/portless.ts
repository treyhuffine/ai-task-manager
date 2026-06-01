/**
 * PortlessProvider — wraps the read-only Portless adapter. Portless owns the
 * process + TLS; Flow just reads `~/.portless/routes.json`. So this provider
 * doesn't manage the dev server (`managesLocalServer: false`): the user runs
 * `portless <name> <dev command>` in the worktree (matching the worktree's
 * basename, which is our preview name), and we surface the `<name>.localhost`
 * URL once the route appears.
 */

import type { PreviewProvider } from './types';
import { PreviewProviderError } from './types';
import { detectPortless, findRoute } from '../portless';

export const portlessProvider: PreviewProvider = {
  id: 'portless',
  label: 'Portless',
  kind: 'static',
  managesLocalServer: false,

  async resolve(ctx) {
    const route = findRoute(ctx.previewName);
    if (!route) {
      throw new PreviewProviderError(
        'portless_no_route',
        `No Portless route registered as ${ctx.previewName}.localhost.`,
        `Run \`portless ${ctx.previewName} <your dev command>\` in the worktree.`,
      );
    }
    return { url: `https://${ctx.previewName}.localhost` };
  },

  isConfigured() {
    return detectPortless().proxyRunning;
  },
};
