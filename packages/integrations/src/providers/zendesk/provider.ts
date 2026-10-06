/**
 * The Zendesk Support provider. Two per-connection wrinkles, both handled by the `custom`
 * strategy: (1) the API host is per-subdomain (`https://<subdomain>.zendesk.com`), rewritten via
 * `ctx.setUrl`; (2) auth is HTTP Basic with the special `"{email}/token:{api_token}"` username.
 * `subdomain`/`email`/`api_token` are `custom` credential values (sealed + Redactor-confined).
 */
import { custom } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export function zendesk(): Provider {
  return defineProvider({
    id: 'zendesk',
    displayName: 'Zendesk',
    // Placeholder host; the custom strategy rewrites it to the connection's subdomain.
    baseUrl: 'https://placeholder.zendesk.com',
    auth: custom({
      secretFields: ['subdomain', 'email', 'api_token'],
      apply: (req, v) => {
        const basic = Buffer.from(`${v.email}/token:${v.api_token}`).toString('base64');
        req.headers.Authorization = `Basic ${basic}`;
        const u = new URL(req.url);
        u.host = `${v.subdomain}.zendesk.com`;
        req.setUrl(u.toString());
      },
    }),
    async identify(http: AuthedHttp) {
      const me = await http.get<{ user: { id: number; email?: string; name?: string } }>('/api/v2/users/me.json');
      return {
        accountId: String(me.user.id),
        ...(me.user.email !== undefined ? { email: me.user.email } : {}),
        ...(me.user.name !== undefined ? { label: me.user.name } : {}),
      };
    },
  });
}
