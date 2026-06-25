/**
 * The Slack provider — OAuth2 (v2). One consent yields a bot/user token used as a
 * `Authorization: Bearer` against the Web API. `identify()` resolves the workspace+user
 * via auth.test. Slack's authorize endpoint wants comma-separated scopes, so the strategy sets
 * `scopeSeparator: ','`.
 */
import { oauth2 } from '../../auth/oauth2';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface SlackProviderOptions {
  fetch?: typeof fetch;
}

interface AuthTest {
  ok?: boolean;
  user_id?: string;
  team_id?: string;
  user?: string;
  team?: string;
  error?: string;
}

export function slack(options: SlackProviderOptions = {}): Provider {
  return defineProvider({
    id: 'slack',
    displayName: 'Slack',
    baseUrl: 'https://slack.com/api',
    identityScopes: [],
    revokeUrl: 'https://slack.com/api/auth.revoke',
    auth: oauth2({
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      usePkce: false,
      scopeSeparator: ',', // Slack wants comma-separated scopes on the authorize URL
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const me = await http.get<AuthTest>('/auth.test');
      if (me.ok === false || !me.user_id) throw new Error(`slack identify failed: ${me.error ?? 'no user_id'}`);
      return {
        accountId: `${me.team_id ?? ''}:${me.user_id}`,
        label: `${me.team ?? 'Slack'} (${me.user ?? me.user_id})`,
      };
    },
  });
}
