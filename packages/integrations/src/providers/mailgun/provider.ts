/**
 * The Mailgun provider — transactional email. Auth is HTTP Basic with the literal username `api`
 * and the API key as the password, handled by the `custom` strategy. The sending domain is a
 * per-call action input (a Mailgun account can have several), not a connection-fixed id. US is the
 * default region; pass `{ region: 'eu' }` for the EU base host. No per-user identity endpoint, so
 * connectDirect assigns accountId 'mailgun:default'; `healthCheck` validates the key via /v4/domains.
 */
import { custom } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface MailgunProviderOptions {
  /** API region: 'us' (default, api.mailgun.net) or 'eu' (api.eu.mailgun.net). */
  region?: 'us' | 'eu';
}

export function mailgun(options: MailgunProviderOptions = {}): Provider {
  const baseUrl = options.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
  return defineProvider({
    id: 'mailgun',
    displayName: 'Mailgun',
    baseUrl,
    auth: custom({
      secretFields: ['api_key'],
      apply: (req, v) => {
        req.headers.Authorization = `Basic ${Buffer.from(`api:${v.api_key}`).toString('base64')}`;
      },
    }),
    async healthCheck(http: AuthedHttp) {
      await http.get('/v4/domains');
    },
  });
}
