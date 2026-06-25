/**
 * The Telegram Bot provider. Telegram authenticates by embedding the bot token in the URL PATH
 * (`https://api.telegram.org/bot<TOKEN>/<method>`) — not a header, query, or body — so it uses
 * the `custom` strategy with `setUrl` to rewrite the path. The token is a `custom` credential
 * value (sealed + Redactor-confined); actions declare clean paths (`/sendMessage`) and the
 * strategy injects `/bot<token>` in front.
 */
import { custom } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import { ConnectorError } from '../../core/errors';
import type { AuthedHttp, Provider } from '../../core/types';

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

/** Unwrap Telegram's `{ ok, result, description }` envelope, throwing on `ok: false`. */
export function telegramResult<T>(raw: unknown): T {
  const env = raw as TelegramEnvelope<T>;
  if (!env || env.ok !== true) {
    throw new ConnectorError('provider_error', `telegram: ${env?.description ?? 'request failed'}`);
  }
  return env.result as T;
}

export function telegram(): Provider {
  return defineProvider({
    id: 'telegram',
    displayName: 'Telegram',
    baseUrl: 'https://api.telegram.org',
    auth: custom({
      secretFields: ['token'],
      apply: (req, v) => {
        // Inject /bot<token> in front of the method path (Telegram's path-embedded auth).
        const u = new URL(req.url);
        u.pathname = `/bot${v.token}${u.pathname}`;
        req.setUrl(u.toString());
      },
    }),
    async identify(http: AuthedHttp) {
      const me = telegramResult<{ id: number; username?: string; first_name?: string }>(await http.get('/getMe'));
      return {
        accountId: String(me.id),
        label: me.username ?? me.first_name ?? `bot:${me.id}`,
      };
    },
  });
}
