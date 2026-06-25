/**
 * The Airtable provider — personal-access-token auth (sent as `Authorization: Bearer`).
 * No OAuth flow; credentials never expire. `identify()` uses the meta `whoami` endpoint so
 * connectDirect derives a real account id.
 */
import { apiKey } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

interface WhoAmI {
  id?: string;
  email?: string;
}

export function airtable(): Provider {
  return defineProvider({
    id: 'airtable',
    displayName: 'Airtable',
    baseUrl: 'https://api.airtable.com/v0',
    auth: apiKey({ prefix: 'Bearer ' }),
    async identify(http: AuthedHttp) {
      const me = await http.get<WhoAmI>('/meta/whoami');
      if (!me.id) throw new Error('airtable identify: whoami returned no id');
      return {
        accountId: me.id,
        ...(me.email !== undefined ? { email: me.email } : {}),
        label: me.email ?? me.id,
      };
    },
  });
}
