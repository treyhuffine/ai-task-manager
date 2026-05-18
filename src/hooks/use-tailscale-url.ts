/**
 * Convenience hook that returns the Tailscale URL (if any) currently
 * registered for a workspace's Portless route.
 *
 * Reads from the preview status query rather than maintaining a
 * separate subscription — the status route already surfaces
 * `tailscale_url` when applicable, and one query cache key is simpler
 * than two with overlapping concerns.
 */

import { usePreviewStatus } from './use-preview';

export interface TailscaleUrlInfo {
  /** Plain tailnet URL (https://<host>.<tailnet>.ts.net). */
  url: string | null;
  /** Public funnel URL if --funnel is enabled. */
  funnel_url: string | null;
  /** True if this workspace is even using Portless. */
  isPortless: boolean;
}

export function useTailscaleUrl(workspaceId: string | null): TailscaleUrlInfo {
  // Don't poll on focus — this hook is meant to be a lightweight read
  // off the existing preview status cache; the preview pane already
  // keeps it warm. The execution header only reads it when the
  // 3-dot popover is open.
  const { data } = usePreviewStatus(workspaceId, {
    enabled: !!workspaceId,
    refetchInterval: false,
  });
  if (!data || data.mode !== 'portless') {
    return { url: null, funnel_url: null, isPortless: false };
  }
  return {
    url: data.tailscale_url ?? null,
    funnel_url: data.tailscale_funnel_url ?? null,
    isPortless: true,
  };
}
