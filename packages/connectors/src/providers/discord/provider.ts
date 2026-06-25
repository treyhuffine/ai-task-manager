/**
 * The Discord auth provider (OAuth2). One consent backs the Discord toolkit. Raw REST
 * through `ctx.http`; tokens are bearer-injected by the oauth2 strategy. Note that posting
 * messages on a real server usually needs a bot token (`Authorization: Bot <token>`); the
 * OAuth user token works for identity/reads and is what this provider uses.
 */
import { oauth2 } from '../../auth/oauth2';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface DiscordProviderOptions {
  /** Injectable fetch for the token/revoke endpoints (tests). */
  fetch?: typeof fetch;
}

interface DiscordUser {
  id?: string;
  username?: string;
  global_name?: string;
  email?: string;
}

const DISCORD_REVOKE_URL = 'https://discord.com/api/oauth2/token/revoke';

export const DISCORD_SCOPES = {
  identify: 'identify',
  email: 'email',
  guilds: 'guilds',
  messagesRead: 'messages.read',
} as const;

export function discord(options: DiscordProviderOptions = {}): Provider {
  return defineProvider({
    id: 'discord',
    displayName: 'Discord',
    baseUrl: 'https://discord.com/api/v10',
    identityScopes: [DISCORD_SCOPES.identify],
    revokeUrl: DISCORD_REVOKE_URL,
    auth: oauth2({
      authorizationUrl: 'https://discord.com/api/oauth2/authorize',
      tokenUrl: 'https://discord.com/api/oauth2/token',
      revokeUrl: DISCORD_REVOKE_URL,
      usePkce: false,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const me = await http.get<DiscordUser>('/users/@me');
      const accountId = me.id;
      if (!accountId) throw new Error('discord identify: /users/@me returned no id');
      return {
        accountId,
        ...(me.email !== undefined ? { email: me.email } : {}),
        label: me.global_name ?? me.username ?? accountId,
      };
    },
  });
}
