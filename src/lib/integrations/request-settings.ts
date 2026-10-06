/**
 * The switch for agents asking to connect accounts from chat. A leaf module (config only), so the
 * session builders can check it without pulling in the request machinery.
 */
import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';
import { getIntegrationsDir } from './storage';

/** On unless the user turned it off in Settings, Plugins. */
export function integrationRequestsEnabled(): boolean {
  getIntegrationsDir();
  return readAuthConfig()?.integrationRequestsEnabled !== false;
}

export function setIntegrationRequestsEnabled(enabled: boolean): void {
  getIntegrationsDir();
  // Null is the default (on), so turning it back on clears the choice rather than pinning it.
  writeAuthConfig({ integrationRequestsEnabled: enabled ? null : false });
}
