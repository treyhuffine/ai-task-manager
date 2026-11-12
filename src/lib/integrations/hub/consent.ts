import { getHubAppByClientId } from '@/lib/db/queries';
import type { OAuthClient } from '@/lib/oauth/clients';
import { getIntegrationOwnerId, getIntegrationRuntime } from '../runtime';
import { hubConsentOptions, type HubConsentOptions } from './grant';

/**
 * What the hub's consent screen offers an app right now, from the person's live connections, with
 * its current grant ticked when it connects again (docs/personal-apps.md "The hub"). The submitted
 * choice is checked against this same list, so only what was offered can be granted.
 */
export async function hubConsentFor(request: { client: Pick<OAuthClient, 'id'>; scope: string | null }): Promise<HubConsentOptions> {
  const runtime = await getIntegrationRuntime();
  const current = getHubAppByClientId(request.client.id);
  return hubConsentOptions(runtime.getToolkits(), await runtime.listConnections({ ownerId: getIntegrationOwnerId() }), request.scope, current && !current.revokedAt ? current.grant : null);
}
