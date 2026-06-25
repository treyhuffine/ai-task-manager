/**
 * The Plaid provider — uses the `custom` auth strategy because Plaid authenticates by putting
 * `client_id` + `secret` in the JSON request BODY (not a header). The per-item `access_token`
 * is an action input, not a connection credential, so there is no identify().
 */
import { custom } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import type { Provider } from '../../core/types';

export interface PlaidProviderOptions {
  /** Plaid environment base URL. Default sandbox. */
  baseUrl?: string;
}

export function plaid(options: PlaidProviderOptions = {}): Provider {
  return defineProvider({
    id: 'plaid',
    displayName: 'Plaid',
    baseUrl: options.baseUrl ?? 'https://sandbox.plaid.com',
    auth: custom({
      secretFields: ['client_id', 'secret'],
      apply: (req, v) => {
        req.setBodyField('client_id', v.client_id);
        req.setBodyField('secret', v.secret);
      },
    }),
  });
}
