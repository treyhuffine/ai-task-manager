import type { Registry } from '../../core/registry';
import { slack } from './provider';
import type { SlackProviderOptions } from './provider';
import { slackMessaging } from './messaging';

export { slack } from './provider';
export type { SlackProviderOptions } from './provider';
export { slackMessaging } from './messaging';

/** Register the Slack provider + messaging toolkit. */
export function registerSlack(registry: Registry, options: SlackProviderOptions = {}): void {
  registry.addBundle({ provider: slack(options), toolkits: [slackMessaging] });
}
