'use client';

import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Smartphone, Globe, Share2, BookOpen, Github, ExternalLink } from 'lucide-react';
import { BeamdConnect } from '@/components/settings/beamd-connect';
import { usePreviewSettings, useUpdatePreviewSettings } from '@/hooks/use-preview';
import { BEAMD_LINKS } from '@/lib/preview/beamd/links';

/** Window event that opens the Beamd onboarding sheet. Dispatch via
 *  `openBeamdSheet()`. */
export const OPEN_BEAMD_EVENT = 'flow:open-beamd';

/** Open the targeted Beamd sheet from anywhere (promo CTAs, preview errors). */
export function openBeamdSheet(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_BEAMD_EVENT));
  }
}

/**
 * A focused, single-purpose Beamd sheet — distinct from the general Devices
 * sheet. It pitches the value briefly, explains how it works, links out to the
 * open-source repo + docs, and lets you connect right here. Mounted once
 * (globally) and driven entirely by the `OPEN_BEAMD_EVENT`, so any CTA can open
 * it without holding a handle.
 */
export function BeamdSheet() {
  const [open, setOpen] = useState(false);
  const { data: settings, refetch: refetchSettings } = usePreviewSettings();
  const update = useUpdatePreviewSettings();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_BEAMD_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_BEAMD_EVENT, onOpen);
  }, []);

  // Re-check the machine's beamd login every time the sheet opens, so a
  // `beamd login` run in a terminal (or by an agent) shows as connected right
  // away instead of waiting out the query's stale window.
  useEffect(() => {
    if (open) refetchSettings();
  }, [open, refetchSettings]);

  // Connecting implies intent to use it — make beamd the active provider
  // (from localhost, manual, or anything else; only skip if already beamd).
  const handleConnected = () => {
    if (settings && settings.activeProvider !== 'beamd') update.mutate({ activeProvider: 'beamd' });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full sm:!max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Globe size={16} className="text-primary" />
            Beamd
          </SheetTitle>
          <SheetDescription>Open your previews on any device — no deploy, no config.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-8 pt-1">
          {/* Connect — the action, up top for anyone ready to go. */}
          <section className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Connect this machine
            </h4>
            <BeamdConnect onConnected={handleConnected} />
            <p className="text-[11px] text-muted-foreground/70">
              Self-hostable and free, or use a hosted edge — your call.
            </p>
          </section>

          {/* Value — pain + what it does, briefly. */}
          <section className="space-y-2.5">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Your dev server only runs on this machine. Beamd gives each preview a real, secure HTTPS URL — so you can
              open it on your phone, test on actual devices, or send someone a live link, without deploying.
            </p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Running on a server or Mac&nbsp;Mini? Review your apps from your laptop, without shuffling code between
              machines.
            </p>
            <div className="flex flex-wrap gap-3 pt-0.5 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Smartphone size={13} className="text-primary" /> Real devices</span>
              <span className="inline-flex items-center gap-1.5"><Share2 size={13} className="text-primary" /> Share a live link</span>
              <span className="inline-flex items-center gap-1.5"><Globe size={13} className="text-primary" /> Self-hostable</span>
            </div>
          </section>

          {/* How it works — three steps. */}
          <section className="space-y-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">How it works</h4>
            <ol className="space-y-3">
              <Step n={1} title="Connect once">
                Sign this machine in to Beamd. The login lives in <span className="font-mono">~/.beamd</span> and is shared
                with your terminal and agents — set it up below, or just run <span className="font-mono">beamd login</span>.
              </Step>
              <Step n={2} title="Tunnels on demand">
                Each preview gets a secure tunnel only when you ask for it — nothing is exposed until then, and it closes
                when you stop the preview.
              </Step>
              <Step n={3} title="Open anywhere">
                Scan the QR or copy the link from the preview’s “Phone” button. It’s live on any device while the preview
                runs.
              </Step>
            </ol>
          </section>

          {/* Links — repo + docs. */}
          <section className="flex flex-wrap gap-2">
            <LinkPill href={BEAMD_LINKS.repo} icon={<Github size={13} />}>Open source</LinkPill>
            <LinkPill href={BEAMD_LINKS.docs} icon={<BookOpen size={13} />}>Docs</LinkPill>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-card/40 text-[11px] font-semibold text-foreground">
        {n}
      </span>
      <div className="space-y-0.5">
        <p className="text-[12.5px] font-medium text-foreground">{title}</p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

function LinkPill({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
    >
      {icon}
      {children}
      <ExternalLink size={11} className="text-muted-foreground" />
    </a>
  );
}
