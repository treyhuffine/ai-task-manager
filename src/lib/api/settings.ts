import { api } from './client';

export interface PairBaseUrls {
  /** User-configured off-network URL (null if not set). */
  tunnel: string | null;
  /** Auto-detected LAN URL (null if no non-loopback IPv4 interface). */
  lan: string | null;
  /** Always-present localhost URL. */
  local: string;
}

export interface BeamdBaseUrlResponse extends PairBaseUrls {
  beamd: {
    url: string;
    name: string;
    port: number;
  };
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
};
