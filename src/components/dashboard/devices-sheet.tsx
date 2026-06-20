'use client';

import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { MonitorSmartphone } from 'lucide-react';
import { DevicesSection } from '@/components/settings/devices-section';
import { ClientSettings } from '@/components/settings/client-settings';
import { AgentSettingsPanel } from '@/components/settings/agent-settings-panel';
import { PreviewSettingsPanel } from '@/components/settings/preview-settings-panel';

/** Window event that opens the Devices sheet (→ Remote preview). Dispatch
 *  via `openRemotePreviewSettings()`. */
export const OPEN_REMOTE_PREVIEW_EVENT = 'flow:open-remote-preview';

/** Open the Devices sheet from anywhere (deep components, the preview pane). */
export function openRemotePreviewSettings(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_REMOTE_PREVIEW_EVENT));
  }
}

/**
 * Standalone sheet for managing paired devices and the remote base URL.
 *
 * Lifted out of the profile/settings sheet so pairing — a high-intent,
 * frequently-accessed action — has a dedicated top-level entry point.
 */
export function DevicesSheet({
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
} = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  // Open from anywhere (e.g. the preview pane's "Connect Beamd" CTA) via a
  // global event, so deep components don't need a handle to this sheet.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_REMOTE_PREVIEW_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_REMOTE_PREVIEW_EVENT, onOpen);
  }, [setOpen]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {children ? (
        <SheetTrigger asChild>{children}</SheetTrigger>
      ) : (
        <SheetTrigger asChild>
          <button
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
            aria-label="Manage devices"
          >
            <MonitorSmartphone size={14} />
          </button>
        </SheetTrigger>
      )}
      <SheetContent side="right" className="w-full sm:!max-w-2xl">
        <SheetHeader>
          <SheetTitle>Devices</SheetTitle>
          <SheetDescription>
            Pair new devices and manage access for everything signed in.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 px-6 pb-6 overflow-y-auto pt-0.5 space-y-6">
          <AgentSettingsPanel />
          <ClientSettings />
          <PreviewSettingsPanel />
          <DevicesSection />
        </div>
      </SheetContent>
    </Sheet>
  );
}
