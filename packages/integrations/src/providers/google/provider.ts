/**
 * The Google auth provider (§14). One OAuth consent (auth-code + PKCE, offline)
 * backs every Google toolkit — Gmail, Calendar, and future surfaces — so the
 * Provider/Toolkit split (§3) and incremental consent (§7) are exercised by the
 * first slice. Raw REST through `ctx.http`; `googleapis` is deliberately NOT used
 * for auth, since it would own token management and bypass the spine (§14).
 */
import { oauth2 } from '../../auth/oauth2';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface GoogleProviderOptions {
  /** Injectable fetch for the token/revoke endpoints (tests). */
  fetch?: typeof fetch;
}

interface UserInfo {
  sub?: string;
  id?: string;
  email?: string;
  name?: string;
}

// Single source of truth for the revoke endpoint — referenced by both the provider
// (disconnect gate) and the oauth2 strategy (the actual call), so they can't drift.
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export function google(options: GoogleProviderOptions = {}): Provider {
  return defineProvider({
    id: 'google',
    displayName: 'Google',
    baseUrl: 'https://www.googleapis.com',
    identityScopes: ['openid', 'email'],
    revokeUrl: GOOGLE_REVOKE_URL,
    scopeSatisfies: googleScopeSatisfies,
    auth: oauth2({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      revokeUrl: GOOGLE_REVOKE_URL,
      usePkce: true,
      // `access_type=offline` + `prompt=consent` guarantee a refresh token (§14).
      authParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const me = await http.get<UserInfo>('/oauth2/v2/userinfo');
      const accountId = me.sub ?? me.id ?? me.email;
      if (!accountId) throw new Error('google identify: userinfo returned no stable id');
      return {
        accountId,
        ...(me.email !== undefined ? { email: me.email } : {}),
        label: me.email ?? me.name ?? accountId,
      };
    },
  });
}

// Scope constants — referenced by the toolkits so action-level scoping is precise.
export const GOOGLE_SCOPES = {
  calendarFull: 'https://www.googleapis.com/auth/calendar',
  calendarReadonly: 'https://www.googleapis.com/auth/calendar.readonly',
  calendarEvents: 'https://www.googleapis.com/auth/calendar.events',
  calendarEventsReadonly: 'https://www.googleapis.com/auth/calendar.events.readonly',
  gmailFull: 'https://mail.google.com/',
  gmailReadonly: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailCompose: 'https://www.googleapis.com/auth/gmail.compose',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  gmailModify: 'https://www.googleapis.com/auth/gmail.modify',
  driveFull: 'https://www.googleapis.com/auth/drive',
  driveReadonly: 'https://www.googleapis.com/auth/drive.readonly',
  driveFile: 'https://www.googleapis.com/auth/drive.file',
  documents: 'https://www.googleapis.com/auth/documents',
  documentsReadonly: 'https://www.googleapis.com/auth/documents.readonly',
  spreadsheets: 'https://www.googleapis.com/auth/spreadsheets',
  spreadsheetsReadonly: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  // Identity. The short aliases `email`/`profile` are what we REQUEST (identityScopes), but Google
  // grants back (and returns in the token's `scope`) the canonical userinfo URLs — so the two must
  // be treated as equivalent or every call re-prompts for `email`. `openid` is returned as-is.
  userinfoEmail: 'https://www.googleapis.com/auth/userinfo.email',
  userinfoProfile: 'https://www.googleapis.com/auth/userinfo.profile',
} as const;

const S = GOOGLE_SCOPES;

/**
 * Google scopes are hierarchical — a broader granted scope authorizes narrower ones.
 * Without this the flat membership check (runtime §7) over-prompts: a connection holding
 * `gmail.modify` would still get `needs_consent` for `gmail.compose`. Only well-documented,
 * conservative implications are encoded (each KEY granted-scope satisfies its VALUE list);
 * deliberately NOT claiming uncertain ones (e.g. modify ⊇ send).
 */
const SCOPE_IMPLIES: Record<string, readonly string[]> = {
  [S.gmailFull]: [S.gmailReadonly, S.gmailCompose, S.gmailSend, S.gmailModify],
  [S.gmailModify]: [S.gmailReadonly, S.gmailCompose],
  [S.calendarFull]: [S.calendarReadonly, S.calendarEvents, S.calendarEventsReadonly],
  [S.calendarEvents]: [S.calendarEventsReadonly],
  [S.calendarReadonly]: [S.calendarEventsReadonly],
  // Google returns the canonical userinfo URL for the requested `email`/`profile` aliases.
  [S.userinfoEmail]: ['email'],
  [S.userinfoProfile]: ['profile'],
  [S.driveFull]: [S.driveReadonly, S.driveFile],
  [S.documents]: [S.documentsReadonly],
  [S.spreadsheets]: [S.spreadsheetsReadonly],
};

function googleScopeSatisfies(granted: string[], required: string): boolean {
  if (granted.includes(required)) return true;
  return granted.some((g) => SCOPE_IMPLIES[g]?.includes(required) ?? false);
}
