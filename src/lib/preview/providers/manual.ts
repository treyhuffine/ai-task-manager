/**
 * ManualProvider — "run your own tunnel and paste the URL." Reads the
 * `previewUrls` list off the execution (set in the execution view), matching
 * the service. Falls back to a global URL template (`{name}` / `{port}`)
 * when no explicit URL is set. Flow doesn't manage the server here
 * (`managesLocalServer: false`) — the URL points at whatever the user is
 * running.
 */

import type { PreviewProvider } from './types';
import { PreviewProviderError } from './types';
import { getExecution } from '@/lib/db/queries';
import { readPreviewSettings, renderManualTemplate } from '../settings';

export const manualProvider: PreviewProvider = {
  id: 'manual',
  label: 'Manual URL',
  kind: 'static',
  managesLocalServer: false,

  async resolve(ctx) {
    const exec = getExecution(ctx.executionId);
    const urls = exec?.previewUrls ?? [];
    const wantService = ctx.service ?? null;

    // Prefer an exact service match, then the default (null-service) entry.
    const match =
      urls.find((u) => (u.service ?? null) === wantService) ??
      (wantService !== null ? undefined : urls.find((u) => (u.service ?? null) === null));
    if (match?.url?.trim()) {
      return { url: match.url.trim() };
    }

    const templated = renderManualTemplate(readPreviewSettings().manualTemplate, {
      name: ctx.previewName,
      port: ctx.port,
    });
    if (templated) {
      return { url: templated };
    }

    throw new PreviewProviderError(
      'manual_no_url',
      'No preview URL set for this execution.',
      'Paste your tunnel URL on the execution, or set a URL template in preview settings.',
    );
  },
};
