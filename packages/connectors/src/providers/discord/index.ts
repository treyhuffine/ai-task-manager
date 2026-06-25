import type { Registry } from '../../core/registry';
import { discord } from './provider';
import type { DiscordProviderOptions } from './provider';
import { discordToolkit } from './toolkit';

export { discord, DISCORD_SCOPES } from './provider';
export type { DiscordProviderOptions } from './provider';
export { discordToolkit } from './toolkit';

/** Register the Discord provider with its toolkit in one call. */
export function registerDiscord(registry: Registry, options: DiscordProviderOptions = {}): void {
  registry.addBundle({ provider: discord(options), toolkits: [discordToolkit] });
}
