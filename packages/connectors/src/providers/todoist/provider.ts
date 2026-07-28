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
    // Todoist's unified API. The old `rest/v2` host this used to point at now
    // answers 410 Gone for every path, which took the whole connector down —
    // not just one action. Verified: `rest/v2/tasks` → 410, `api/v1/tasks` → 401.
    baseUrl: 'https://api.todoist.com/api/v1',
    auth: apiKey({ prefix: 'Bearer ' }),
    // Todoist exposes no clean identity endpoint, so we omit identify(): connectDirect
    // assigns accountId 'todoist:default' (one Todoist connection per owner — the common case).
  });
}
