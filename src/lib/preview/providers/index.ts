/**
 * Provider entry point. Importing this module registers the built-ins
 * (idempotently) and re-exports the registry + types. Consumers should
 * import provider lookups from here so the built-ins are always present.
 */

import { registerPreviewProvider, listProviderIds } from './registry';
import { localhostProvider } from './localhost';
import { beamdProvider } from './beamd';
import { manualProvider } from './manual';

// Portless isn't a built-in provider: running `portless` is a project-level
// dev-server choice (a package.json script), not a Flow reachability mode —
// it surfaced as a confusing local-only option. The read-only adapter
// (`../portless`) and a `portlessProvider` wrapper still exist for anyone who
// wants to register it via the plugin seam, but it's off the picker by default.

/** Built-in provider ids, in picker order. */
export const BUILTIN_PROVIDER_IDS = ['localhost', 'beamd', 'manual'] as const;

let registered = false;

/** Register the built-in providers once. Safe to call repeatedly. */
export function ensureBuiltinProviders(): void {
  if (registered) return;
  registerPreviewProvider(localhostProvider);
  registerPreviewProvider(beamdProvider);
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
