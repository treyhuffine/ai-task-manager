import type { HostedMcpEndpointSetup } from '@integrations/engine/providers';

export interface HostedEndpointSelection {
  endpointId?: string;
  instanceUrl?: string;
}

/** The saved selection wins over a stale form draft when reconnecting. */
export function integrationEndpointSelection(
  setup: HostedMcpEndpointSetup | undefined,
  draft: HostedEndpointSelection = {},
): HostedEndpointSelection {
  if (!setup) return {};
  if (setup.kind === 'region') {
    const endpointId = setup.locked ? setup.selectedId : draft.endpointId;
    if (!endpointId || !setup.options.some(option => option.id === endpointId)) {
      throw new Error(`Choose ${setup.label.toLowerCase()} before connecting.`);
    }
    return { endpointId };
  }
  const instanceUrl = (setup.locked ? setup.selectedUrl : draft.instanceUrl)?.trim();
  if (!instanceUrl) throw new Error(`Enter your ${setup.label.toLowerCase()} before connecting.`);
  let url: URL;
  try { url = new URL(instanceUrl); }
  catch { throw new Error('Enter a valid instance URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || instanceUrl.includes('?') || instanceUrl.includes('#')) {
    throw new Error('Use an instance URL without credentials, query parameters, or a fragment.');
  }
  if (/[\u0000-\u0020\u007f\\]/.test(instanceUrl)) throw new Error('Use an instance URL without spaces or backslashes.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Use an https:// instance URL. HTTP is supported only for localhost.');
  }
  return { instanceUrl };
}

export function integrationEndpointReady(setup: HostedMcpEndpointSetup | undefined, draft?: HostedEndpointSelection): boolean {
  try { integrationEndpointSelection(setup, draft); return true; }
  catch { return false; }
}
