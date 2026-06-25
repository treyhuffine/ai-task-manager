import type { Registry } from '../../core/registry';
import { airtable } from './provider';
import { airtableToolkit } from './toolkit';

export { airtable } from './provider';
export { airtableToolkit } from './toolkit';

/** Register the Airtable provider + toolkit. Connect via `runtime.connectDirect` with a PAT. */
export function registerAirtable(registry: Registry): void {
  registry.addBundle({ provider: airtable(), toolkits: [airtableToolkit] });
}
