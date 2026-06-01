/**
 * Provider entry point. Importing this module registers the built-ins
 * (idempotently) and re-exports the registry + types. Consumers should
 * import provider lookups from here so the built-ins are always present.
 */

import { registerPreviewProvider, listProviderIds } from './registry';
import { localhostProvider } from './localhost';
import { beamdProvider } from './beamd';
import { portlessProvider } from './portless';
import { manualProvider } from './manual';

/** Built-in provider ids, in picker order. */
export const BUILTIN_PROVIDER_IDS = ['localhost', 'beamd', 'portless', 'manual'] as const;

let registered = false;

/** Register the built-in providers once. Safe to call repeatedly. */
export function ensureBuiltinProviders(): void {
  if (registered) return;
  registerPreviewProvider(localhostProvider);
  registerPreviewProvider(beamdProvider);
  registerPreviewProvider(portlessProvider);
  registerPreviewProvider(manualProvider);
  registered = true;
}

// Register on import — provider lookups go through this module.
ensureBuiltinProviders();

export {
  registerPreviewProvider,
  unregisterPreviewProvider,
  getProvider,
  tryGetProvider,
  listProviders,
  listProviderIds,
} from './registry';
export type { PreviewProvider, PreviewContext, PreviewTarget, PreviewProviderKind } from './types';
export { PreviewProviderError } from './types';
