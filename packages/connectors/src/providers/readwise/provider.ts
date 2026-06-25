/**
 * The Readwise provider — API token sent as `Authorization: Token <key>`. No OAuth flow.
 * Readwise has no identity endpoint (GET /auth/ only validates), so connectDirect assigns
 * accountId 'readwise:default' (one Readwise connection per owner — the common case).
 */
import { apiKey } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import type { Provider } from '../../core/types';

export function readwise(): Provider {
  return defineProvider({
    id: 'readwise',
    displayName: 'Readwise',
    baseUrl: 'https://readwise.io/api/v2',
    auth: apiKey({ prefix: 'Token ' }),
  });
}
