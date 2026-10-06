/**
 * The WhatsApp Business provider (Meta Graph API, outbound-only). Auth is a bearer access token
 * PLUS a per-number `phone_number_id` that lives in the URL path
 * (`/v21.0/<phone_number_id>/messages`). Both are held as a `custom` credential: the strategy
 * sets `Authorization: Bearer <token>` and rewrites the path to inject the phone number id
 * (mirrors Telegram's path-embedded auth via `ctx.setUrl`).
 */
import { custom } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export function whatsapp(): Provider {
  return defineProvider({
    id: 'whatsapp',
    displayName: 'WhatsApp',
    baseUrl: 'https://graph.facebook.com',
    auth: custom({
      secretFields: ['access_token', 'phone_number_id'],
      apply: (req, v) => {
        req.headers.Authorization = `Bearer ${v.access_token}`;
        const u = new URL(req.url);
        u.pathname = u.pathname.replace(/^\/v21\.0/, `/v21.0/${v.phone_number_id}`);
        req.setUrl(u.toString());
      },
    }),
    async identify(http: AuthedHttp) {
      const me = await http.get<{ display_phone_number?: string; verified_name?: string }>('/v21.0', {
        query: { fields: 'display_phone_number,verified_name' },
      });
      return {
        accountId: me.display_phone_number ?? 'whatsapp',
        label: me.verified_name ?? me.display_phone_number ?? 'WhatsApp',
      };
    },
  });
}
