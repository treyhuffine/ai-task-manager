/**
 * The switch for agents asking to connect accounts from chat. A leaf module (config only), so the
 * session builders can check it without pulling in the request machinery.
 */
import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';

/** On unless the user turned it off in Settings, Plugins. */
export function connectorRequestsEnabled(): boolean {
  return readAuthConfig()?.connectorRequestsEnabled !== false;
}

export function setConnectorRequestsEnabled(enabled: boolean): void {
  // Null is the default (on), so turning it back on clears the choice rather than pinning it.
  writeAuthConfig({ connectorRequestsEnabled: enabled ? null : false });
}
