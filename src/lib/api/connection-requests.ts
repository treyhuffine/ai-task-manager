import { api } from './client';
import type { ProviderStatus } from '@/components/settings/sections/connectors/types';

export type ConnectionCardAction = 'sign_in' | 'key' | 'allow' | 'decline';

export interface ConnectionCardBody {
  action: ConnectionCardAction;
  fields?: Record<string, string>;
  returnTo?: string;
  /** For `allow`: exactly the account ids checked on the card. */
  accounts?: string[];
}

export type ConnectionCardResult =
  | { done: true }
  | { requestId: string; authorizationUrl: string; desktopFlowId?: string };

export interface ConnectorStatusResponse {
  redirectUri: string;
  providers: ProviderStatus[];
}

export const connectionRequestsApi = {
  /** Answer a Connect card: start a sign-in, submit a key, allow an agent, or say not now. */
  act: (eventId: string, body: ConnectionCardBody) =>
    api.post<ConnectionCardResult>(`/connectors/requests/${encodeURIComponent(eventId)}`, body),

  /** Which providers can connect in one click, and the redirect URI a new sign-in app registers. */
  status: () => api.get<ConnectorStatusResponse>('/connectors/status'),

  /** Save a sign-in app for a provider, the same way Settings does. */
  addSignInApp: (body: { providerId: string; label: string; oauth: { clientId: string; redirectUri: string }; clientSecret?: string }) =>
    api.post('/connectors/auth-configs', body),

  settings: () => api.get<{ requestsEnabled: boolean }>('/connectors/request-settings'),
  setRequestsEnabled: (requestsEnabled: boolean) =>
    api.patch<{ requestsEnabled: boolean }>('/connectors/request-settings', { requestsEnabled }),
};
