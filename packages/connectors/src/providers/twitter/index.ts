import type { Registry } from '../../core/registry';
import { twitter } from './provider';
import type { TwitterProviderOptions } from './provider';
import { buildTwitterToolkit, type TwitterToolkitOptions } from './toolkit';

export { twitter } from './provider';
export type { TwitterProviderOptions } from './provider';
export { buildTwitterToolkit, twitterToolkit } from './toolkit';
export type { TwitterToolkitOptions } from './toolkit';
export { TWITTER_OPS, TWITTER_OAUTH_SCOPES } from './operations.generated';
export type { TwitterOp } from './operations.generated';

export type RegisterTwitterOptions = TwitterProviderOptions & TwitterToolkitOptions;

/**
 * Register the X (Twitter) provider with its full (OpenAPI-generated) toolkit. The action set can be
 * trimmed via `allowlist`/`denylist` (parity with XMCP's X_API_TOOL_ALLOWLIST) — the host reads
 * those from env and passes them in, keeping the engine package free of `process.env`.
 */
export function registerTwitter(registry: Registry, options: RegisterTwitterOptions = {}): void {
  const { allowlist, denylist, tags, mediaChunkBytes, ...providerOptions } = options;
  const toolkit = buildTwitterToolkit({
    ...(allowlist ? { allowlist } : {}),
    ...(denylist ? { denylist } : {}),
    ...(tags ? { tags } : {}),
    ...(mediaChunkBytes !== undefined ? { mediaChunkBytes } : {}),
  });
  registry.addBundle({ provider: twitter(providerOptions), toolkits: [toolkit] });
}
