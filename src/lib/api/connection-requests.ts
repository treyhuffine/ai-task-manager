import { trpcClient } from '@/lib/trpc/client';
import type { RouterInputs, RouterOutputs } from '@/lib/trpc/router';

export type ConnectionCardAction = 'sign_in' | 'key' | 'allow' | 'decline';

export type ConnectionCardBody = RouterInputs['integrations']['requestsEventIdPost']['body'];

export type ConnectionCardResult = RouterOutputs['integrations']['requestsEventIdPost'];

export type IntegrationStatusResponse = RouterOutputs['integrations']['statusGet'];

export const connectionRequestsApi = {
  /** Answer a Connect card: start a sign-in, submit a key, allow an agent, or say not now. */
  act: (eventId: string, body: ConnectionCardBody) =>
    trpcClient.integrations.requestsEventIdPost.mutate({params: {eventId: eventId}, body: body}),

  /** Which providers can connect in one click, and the redirect URI a new sign-in app registers. */
  status: () => trpcClient.integrations.statusGet.query({}),

  /** Save a sign-in app for a provider, the same way Settings does. */
  addSignInApp: (body: { providerId: string; label: string; oauth: { clientId: string; redirectUri: string }; clientSecret?: string }) =>
    trpcClient.integrations.authConfigsPost.mutate({body: body}),

  settings: () => trpcClient.integrations.requestSettingsGet.query({}),
  setRequestsEnabled: (requestsEnabled: boolean) =>
    trpcClient.integrations.requestSettingsPatch.mutate({body: { requestsEnabled }}),
};
