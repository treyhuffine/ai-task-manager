/**
 * LocalhostProvider — the URL when the viewing browser is on the same host
 * as Flow. A bare loopback URL to the supervised dev server's port. Always
 * available, always the right answer for "I'm on the Mini."
 */

import type { PreviewProvider } from './types';

export const localhostProvider: PreviewProvider = {
  id: 'localhost',
  label: 'Localhost',
  kind: 'static',
  managesLocalServer: true,
  async resolve(ctx) {
    return { url: `http://localhost:${ctx.port}` };
  },
};
