import { api } from './client';

export interface PairBaseUrls {
  /** User-configured off-network URL (null if not set). */
  tunnel: string | null;
  /** Auto-detected LAN URL (null if no non-loopback IPv4 interface). */
  lan: string | null;
  /** Always-present localhost URL. */
  local: string;
  /** Whether the app re-opens its beamd tunnel at boot to stay reachable. */
  autoTunnel: boolean;
  /** Custom beamd tunnel name, or null when the default is in use. */
  tunnelName: string | null;
  /** The label the tunnel actually opens under (custom or default). */
  effectiveTunnelName: string;
  /** The label used when no custom name is set. */
  defaultTunnelName: string;
  /** True when an env var pins the name, so the settings field is read-only. */
  tunnelNameLocked: boolean;
  /** The env var that pins it, for the read-only explanation. */
  tunnelNameEnvVar: string;
}

export interface BeamdBaseUrlResponse extends PairBaseUrls {
  beamd: {
    url: string;
    name: string;
    port: number;
  };
}

export interface TunnelNameResponse extends PairBaseUrls {
  /** Set when the rename re-opened the tunnel under the new name. */
  reopened: { url: string; name: string } | null;
  /** The old name, if a live tunnel here was torn down as part of the rename. */
  closedPrevious: string | null;
}

export const settingsApi = {
  getBaseUrls(): Promise<PairBaseUrls> {
    return api.get<PairBaseUrls>('/settings/base-url');
  },

  setTunnelUrl(baseUrl: string | null): Promise<PairBaseUrls> {
    return api.patch<PairBaseUrls>('/settings/base-url', { baseUrl });
  },

  useBeamdTunnelUrl(): Promise<BeamdBaseUrlResponse> {
    return api.post<BeamdBaseUrlResponse>('/settings/base-url/beamd');
  },

  setAutoTunnel(enabled: boolean): Promise<PairBaseUrls> {
    return api.post<PairBaseUrls>('/settings/base-url/auto-tunnel', { enabled });
  },

  /** Set the beamd tunnel name. `null` reverts to the default. */
  setTunnelName(name: string | null): Promise<TunnelNameResponse> {
    return api.post<TunnelNameResponse>('/settings/base-url/tunnel-name', { name });
  },
};
