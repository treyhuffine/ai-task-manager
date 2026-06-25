import type { Registry } from '../../core/registry';
import { todoist } from './provider';
import { todoistToolkit } from './toolkit';

export { todoist } from './provider';
export { todoistToolkit } from './toolkit';

/** Register the Todoist provider + toolkit. Connect via `runtime.connectDirect` with an API key. */
export function registerTodoist(registry: Registry): void {
  registry.addBundle({ provider: todoist(), toolkits: [todoistToolkit] });
}
