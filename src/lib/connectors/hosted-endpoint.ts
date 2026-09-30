import type { HostedMcpProvider, HostedMcpEndpointSetup } from '@connectors/engine/providers';
import { validateMcpUrl } from './mcp-validate';

export interface HostedEndpointInput { endpointId?: unknown; instanceUrl?: unknown }

/** Resolve user choices through the catalog. Never accept a replacement service URL. */
export function resolveHostedMcpUrl(definition: HostedMcpProvider, input: HostedEndpointInput = {}): string {
  const configuration = definition.endpoint;
  if (!configuration) {
    if (input.endpointId !== undefined || input.instanceUrl !== undefined) throw new Error('This connector has a fixed service address.');
    if (!definition.url) throw new Error('The connector has no configured service address.');
    return definition.url;
  }
  if (configuration.kind === 'region') {
    if (input.instanceUrl !== undefined) throw new Error(`Choose ${configuration.label.toLowerCase()}, not an instance URL.`);
    const option = configuration.options.find((candidate) => candidate.id === input.endpointId);
    if (!option) throw new Error(`Choose a supported ${configuration.label.toLowerCase()}.`);
    return option.url;
  }
  if (input.endpointId !== undefined) throw new Error('This connector requires an instance URL, not a region.');
  if (typeof input.instanceUrl !== 'string') throw new Error('An instance URL is required.');
  const raw = input.instanceUrl.trim();
  if (/[\u0000-\u0020\u007f\\]/.test(raw)) throw new Error('Use a valid instance URL without spaces or backslashes.');
  const checked = validateMcpUrl(raw);
  if (!checked.ok) throw new Error(checked.error);
  const url = new URL(checked.url);
  if (url.username || url.password || raw.includes('?') || raw.includes('#')) throw new Error('The instance URL must not contain credentials, query parameters, or a fragment.');
  if (/%2f|%5c/i.test(url.pathname)) throw new Error('The instance URL contains an invalid path.');
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.endsWith(configuration.path) ? pathname : `${pathname}${configuration.path}`;
  return url.href;
}

/** Revalidate stored authority on every use, not just when the user first connects. */
export function hostedMcpUrlMatches(definition: HostedMcpProvider, url: string): boolean {
  if (!definition.endpoint) return url === definition.url;
  if (definition.endpoint.kind === 'region') return definition.endpoint.options.some((option) => option.url === url);
  try { return resolveHostedMcpUrl(definition, { instanceUrl: url }) === url; }
  catch { return false; }
}

export function hostedMcpEndpointSetup(definition: HostedMcpProvider, entry?: { url: string }): HostedMcpEndpointSetup | undefined {
  const configuration = definition.endpoint;
  if (!configuration) return undefined;
  // An invalid saved address must not break the entire settings catalog or
  // expose embedded credential bytes. The connection can still be removed.
  const valid = entry && hostedMcpUrlMatches(definition, entry.url);
  if (configuration.kind === 'region') return {
    kind: 'region', label: configuration.label,
    options: configuration.options.map(({ id, label }) => ({ id, label })),
    ...(valid ? { selectedId: configuration.options.find((option) => option.url === entry.url)!.id } : {}),
    locked: Boolean(entry),
  };
  return {
    kind: 'instance', label: configuration.label, placeholder: configuration.placeholder,
    ...(valid ? { selectedUrl: entry.url.slice(0, -configuration.path.length) } : {}),
    locked: Boolean(entry),
  };
}

/** A user-selected server does not inherit a vendor's trusted tool annotations. */
export function trustHostedMcpAnnotations(definition: HostedMcpProvider): boolean {
  return definition.endpoint?.kind !== 'instance';
}
