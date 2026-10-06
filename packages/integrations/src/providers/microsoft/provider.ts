/**
 * The Microsoft 365 (Microsoft Graph) auth provider. One OAuth2 consent (auth-code + PKCE,
 * `offline_access` for refresh) backs the Outlook Mail + Calendar toolkits. Raw REST through
 * `ctx.http` against Graph v1.0; tokens flow through the spine like every other provider.
 */
import { oauth2 } from '../../auth/oauth2';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface MicrosoftProviderOptions {
  /** Injectable fetch for the token endpoint (tests). */
  fetch?: typeof fetch;
}

interface MeResponse {
  id?: string;
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
}

// Graph delegated scopes — referenced by the toolkits so action scoping stays precise.
export const MICROSOFT_SCOPES = {
  userRead: 'User.Read',
  mailRead: 'Mail.Read',
  mailReadWrite: 'Mail.ReadWrite',
  mailSend: 'Mail.Send',
  calendarsRead: 'Calendars.Read',
  calendarsReadWrite: 'Calendars.ReadWrite',
} as const;

const M = MICROSOFT_SCOPES;

// Graph scopes are hierarchical: the read-write scope authorizes the matching read scope, so a
// connection holding Calendars.ReadWrite doesn't re-prompt for a Calendars.Read action.
const SCOPE_IMPLIES: Record<string, readonly string[]> = {
  [M.mailReadWrite]: [M.mailRead],
  [M.calendarsReadWrite]: [M.calendarsRead],
};

function microsoftScopeSatisfies(granted: string[], required: string): boolean {
  if (granted.includes(required)) return true;
  return granted.some((g) => SCOPE_IMPLIES[g]?.includes(required) ?? false);
}

export function microsoft(options: MicrosoftProviderOptions = {}): Provider {
  return defineProvider({
    id: 'microsoft',
    displayName: 'Microsoft 365',
    baseUrl: 'https://graph.microsoft.com/v1.0',
    // `offline_access` is required for a refresh token; openid/email for identity.
    identityScopes: ['openid', 'email', 'offline_access', M.userRead],
    scopeSatisfies: microsoftScopeSatisfies,
    auth: oauth2({
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      usePkce: true,
      authParams: { prompt: 'select_account' },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const me = await http.get<MeResponse>('/me');
      const email = me.mail ?? me.userPrincipalName;
      const accountId = me.id ?? email;
      if (!accountId) throw new Error('microsoft identify: /me returned no stable id');
      return {
        accountId,
        ...(email !== undefined ? { email } : {}),
        label: me.displayName ?? email ?? accountId,
      };
    },
  });
}
