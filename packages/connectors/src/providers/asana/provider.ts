/**
 * The Asana provider — personal-access-token auth (sent as `Authorization: Bearer`). No OAuth
 * flow; the token never expires. Asana wraps every response in `{ data }`, so `identify()` and
 * the toolkit mappers read `raw.data`. `identify()` uses `/users/me` so connectDirect derives a
 * real account id (the user's `gid`).
 */
import { bearer } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

interface AsanaUser {
  data?: { gid?: string; name?: string; email?: string };
}

export function asana(): Provider {
  return defineProvider({
    id: 'asana',
    displayName: 'Asana',
    baseUrl: 'https://app.asana.com/api/1.0',
    auth: bearer(),
    async identify(http: AuthedHttp) {
      const me = await http.get<AsanaUser>('/users/me');
      const user = me.data;
      if (!user?.gid) throw new Error('asana identify: /users/me returned no gid');
      return {
        accountId: user.gid,
        ...(user.email !== undefined ? { email: user.email } : {}),
        label: user.name ?? user.email ?? user.gid,
      };
    },
  });
}
