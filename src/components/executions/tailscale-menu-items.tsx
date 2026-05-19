'use client';

import { useState } from 'react';
import { ExternalLink, Copy, Check, Globe2 } from 'lucide-react';
import { useTailscaleUrl } from '@/hooks/use-tailscale-url';
import { toast } from 'sonner';

interface TailscaleMenuItemsProps {
  workspaceId: string | null;
}

/**
 * Menu items shown in the execution header's 3-dot popover when the
 * workspace's Portless route has a tailscale URL. Returns null otherwise
 * so the caller can `&&` it in without an extra check.
 *
 * Two affordances:
 *   - "Open on Tailscale" — opens the tailnet URL in a new tab. Direct
 *     route, bypasses Flow's proxy entirely (no base-path quirks, no
 *     auth juggling — the tailnet IS the trust boundary).
 *   - "Copy Tailscale URL" — for sharing with teammates on the same tailnet.
 *
 * If `--funnel` is on and the route exposes a public funnel URL, an
 * extra "Open Tailscale Funnel" item appears below.
 */
export function TailscaleMenuItems({ workspaceId }: TailscaleMenuItemsProps) {
  const { url, funnel_url } = useTailscaleUrl(workspaceId);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  if (!url) return null;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      toast.success(`Copied ${label}`);
      setTimeout(() => setCopiedUrl(null), 1200);
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className="flex flex-col gap-0.5">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded px-2 py-1.5 text-[12px] text-foreground hover:bg-muted"
      >
        <Globe2 size={13} className="text-muted-foreground" />
        Open on Tailscale
        <ExternalLink size={11} className="ml-auto text-muted-foreground" />
      </a>
      <button
        type="button"
        onClick={() => copy(url, 'Tailscale URL')}
        className="flex items-center gap-2 rounded px-2 py-1.5 text-[12px] text-foreground hover:bg-muted"
      >
        {copiedUrl === url ? (
          <Check size={13} className="text-muted-foreground" />
        ) : (
          <Copy size={13} className="text-muted-foreground" />
        )}
        Copy Tailscale URL
      </button>
      {funnel_url && (
        <a
          href={funnel_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded px-2 py-1.5 text-[12px] text-foreground hover:bg-muted"
        >
          <Globe2 size={13} className="text-muted-foreground" />
          Open Tailscale Funnel (public)
          <ExternalLink size={11} className="ml-auto text-muted-foreground" />
        </a>
      )}
    </div>
  );
}
