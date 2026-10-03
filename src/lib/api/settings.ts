import { trpcClient } from '@/lib/trpc/client';
import type { RouterOutputs } from '@/lib/trpc/router';

export type PairBaseUrls = RouterOutputs['settings']['baseUrlGet'];

export type BeamdBaseUrlResponse = RouterOutputs['settings']['baseUrlBeamdPost'];

export type TunnelNameResponse = RouterOutputs['settings']['baseUrlTunnelNamePost'];

export const settingsApi = {
  getBaseUrls() {
    return trpcClient.settings.baseUrlGet.query({});
  },

  setTunnelUrl(baseUrl: string | null) {
    return trpcClient.settings.baseUrlPatch.mutate({body: { baseUrl }});
  },

  useBeamdTunnelUrl() {
    return trpcClient.settings.baseUrlBeamdPost.mutate({});
  },

  setAutoTunnel(enabled: boolean) {
    return trpcClient.settings.baseUrlAutoTunnelPost.mutate({body: { enabled }});
  },

  /** Set the beamd tunnel name. `null` reverts to the default. */
  setTunnelName(name: string | null) {
    return trpcClient.settings.baseUrlTunnelNamePost.mutate({body: { name }});
  },
};
