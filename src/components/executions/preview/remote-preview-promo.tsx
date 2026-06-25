'use client';

import { Smartphone, Globe } from 'lucide-react';
import { openSettings } from '@/components/settings/settings-store';

/**
 * Discovery affordance for remote preview, shown in the preview tab's empty
 * states. Two sizes:
 *   - `prominent` (no preview set up yet) → a full card that teaches the
 *     feature and links into setup.
 *   - otherwise → a single subtle line.
 *
 * Visibility/setup gating lives in the caller (PreviewBody), which hides this
 * once remote preview is actually configured — by then the header's "Phone"
 * button is the subtle, always-present entry point.
 */
export function RemotePreviewPromo({ prominent }: { prominent: boolean }) {
  if (!prominent) {
    return (
      <button
        type="button"
        onClick={() => openSettings('remote-preview')}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Smartphone size={12} className="text-primary" />
        Preview on any device with Beamd →
      </button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-border bg-card/40 p-3">
      <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <Smartphone size={13} className="text-primary" />
        Preview on any device
      </h4>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Open your preview on your phone or tablet, or share a live link, no deploy. Running on a server or
        Mac&nbsp;Mini? Review your apps from your laptop, without shuffling code between machines.
      </p>
      <button
        type="button"
        onClick={() => openSettings('remote-preview')}
        className="flex items-center gap-1.5 rounded-md border border-border bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:bg-foreground/90"
      >
        <Globe size={13} />
        Set up Beamd
      </button>
    </div>
  );
}
