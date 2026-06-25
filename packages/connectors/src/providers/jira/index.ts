import type { Registry } from '../../core/registry';
import { jira } from './provider';
import type { JiraProviderOptions } from './provider';
import { jiraToolkit } from './toolkit';

export { jira } from './provider';
export type { JiraProviderOptions } from './provider';
export { jiraToolkit } from './toolkit';

/** Register the Jira provider with its toolkit in one call. */
export function registerJira(registry: Registry, options: JiraProviderOptions = {}): void {
  registry.addBundle({ provider: jira(options), toolkits: [jiraToolkit] });
}
