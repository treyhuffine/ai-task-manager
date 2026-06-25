/**
 * The Dropbox provider (OAuth2). Dropbox API v2 is RPC-style: nearly every endpoint is a POST
 * with a JSON body, even reads. `token_access_type=offline` is requested so a refresh token is
 * issued. One Dropbox connection backs the files toolkit.
 */
import { oauth2 } from '../../auth/oauth2';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface DropboxProviderOptions {
  /** Injectable fetch for the token/revoke endpoints (tests). */
  fetch?: typeof fetch;
}

export const DROPBOX_SCOPES = {
  accountRead: 'account_info.read',
  filesMetadataRead: 'files.metadata.read',
  filesContentRead: 'files.content.read',
  filesContentWrite: 'files.content.write',
} as const;

interface CurrentAccount {
  account_id?: string;
  email?: string;
  name?: { display_name?: string };
}

export function dropbox(options: DropboxProviderOptions = {}): Provider {
  return defineProvider({
    id: 'dropbox',
    displayName: 'Dropbox',
    baseUrl: 'https://api.dropboxapi.com/2',
    auth: oauth2({
      authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
      tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
      revokeUrl: 'https://api.dropboxapi.com/2/auth/token/revoke',
      usePkce: true,
      authParams: { token_access_type: 'offline' },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    revokeUrl: 'https://api.dropboxapi.com/2/auth/token/revoke',
    async identify(http: AuthedHttp) {
      const me = await http.post<CurrentAccount>('/users/get_current_account');
      const accountId = me.account_id ?? me.email;
      if (!accountId) throw new Error('dropbox identify: get_current_account returned no id');
      return {
        accountId,
        ...(me.email !== undefined ? { email: me.email } : {}),
        label: me.name?.display_name ?? me.email ?? accountId,
      };
    },
  });
}
