/**
 * The Resend provider — transactional email. API key sent as `Authorization: Bearer <key>`.
 * No OAuth, no per-user identity endpoint, so connectDirect assigns accountId 'resend:default'
 * (one Resend connection per owner — the common case). `healthCheck` validates the key with a
 * cheap domains read for `testConnection`.
 */
import { apiKey } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export function resend(): Provider {
  return defineProvider({
    id: 'resend',
    displayName: 'Resend',
    baseUrl: 'https://api.resend.com',
    auth: apiKey({ prefix: 'Bearer ' }),
    async healthCheck(http: AuthedHttp) {
      await http.get('/domains');
    },
  });
}
