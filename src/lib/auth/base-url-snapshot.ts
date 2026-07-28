/**
 * The single shape every `/api/settings/base-url*` route returns. Kept in one
 * place so the four routes that mutate different corners of it (URL, auto
 * reconnect, tunnel name, beamd open) can never drift apart in what they
 * report back.
 */

import {
  getAutoTunnel,
  getLanBaseUrl,
  getLocalBaseUrl,
  getRemoteBaseUrl,
} from '@/lib/auth/bootstrap';
import {
  appBeamdTunnelName,
  customBeamdTunnelName,
  defaultBeamdTunnelName,
  tunnelNameIsEnvLocked,
  TUNNEL_NAME_ENV,
} from '@/lib/auth/beamd-base-url';

export interface BaseUrlSnapshot {
  /** User-configured off-network URL (null if not set). */
  tunnel: string | null;
  /** Auto-detected LAN URL (null if no non-loopback IPv4 interface). */
  lan: string | null;
  /** Always-present localhost URL. */
  local: string;
  /** Whether the app re-opens its beamd tunnel at boot to stay reachable. */
  autoTunnel: boolean;
  /** Custom tunnel name override, or null when the default is in use. */
  tunnelName: string | null;
  /** The label the tunnel actually opens under (override or default). */
  effectiveTunnelName: string;
  /** The label used when no override is set — the input's placeholder. */
  defaultTunnelName: string;
  /** True when the env var pins the name, so a settings edit can't take effect. */
  tunnelNameLocked: boolean;
  /** Name of the env var that pins it, for the "locked" message. */
  tunnelNameEnvVar: string;
}

export function baseUrlSnapshot(): BaseUrlSnapshot {
  return {
    tunnel: getRemoteBaseUrl(),
    lan: getLanBaseUrl(),
    local: getLocalBaseUrl(),
    autoTunnel: getAutoTunnel(),
    tunnelName: customBeamdTunnelName(),
    effectiveTunnelName: appBeamdTunnelName(),
    defaultTunnelName: defaultBeamdTunnelName(),
    tunnelNameLocked: tunnelNameIsEnvLocked(),
    tunnelNameEnvVar: TUNNEL_NAME_ENV,
  };
}
