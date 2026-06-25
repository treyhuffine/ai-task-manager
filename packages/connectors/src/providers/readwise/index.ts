import type { Registry } from '../../core/registry';
import { readwise } from './provider';
import { readwiseHighlights } from './highlights';

export { readwise } from './provider';
export { readwiseHighlights } from './highlights';

/** Register the Readwise provider + toolkit. Connect via `runtime.connectDirect` with an API token. */
export function registerReadwise(registry: Registry): void {
  registry.addBundle({ provider: readwise(), toolkits: [readwiseHighlights] });
}
