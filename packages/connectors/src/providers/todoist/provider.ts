/**
 * The Todoist provider — API-key auth (a personal token sent as `Authorization: Bearer`).
 * No OAuth flow, so credentials never expire and there is no refresh seam.
 */
import { apiKey } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import type { Provider } from '../../core/types';

export function todoist(): Provider {
  return defineProvider({
    id: 'todoist',
    displayName: 'Todoist',
    baseUrl: 'https://api.todoist.com/rest/v2',
    auth: apiKey({ prefix: 'Bearer ' }),
    // Todoist REST v2 exposes no clean identity endpoint, so we omit identify(): connectDirect
    // assigns accountId 'todoist:default' (one Todoist connection per owner — the common case).
  });
}
