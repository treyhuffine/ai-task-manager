'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { SettingsNav } from './settings-nav';
import {
  useSettingsStore,
  openSettings,
  closeSettings,
  setSettingsSection,
  consumeAutoLand,
} from './settings-store';
import { getSection, isSectionId, DEFAULT_SECTION, type SectionId } from './settings-sections';
import { useSetupChecklist, type SetupChecklist } from './use-setup-checklist';

import { GetStartedSection } from './sections/get-started-section';
import { ProfileSection } from './sections/profile-section';
import { GeneralSection } from './sections/general-section';
import { ModelsSection } from './sections/models-section';
import { VoiceSection } from './sections/voice-section';
import { BrowserSection } from './sections/browser-section';
import { ConnectorsSection } from './sections/connectors-section';
import { NotificationsSection } from './sections/notifications-section';
import { DevicesSettingsSection } from './sections/devices-section';
import { RemotePreviewSection } from './sections/remote-preview-section';
import { ImportsSection } from './sections/imports-section';

function SectionBody({ id, checklist }: { id: SectionId; checklist: SetupChecklist }) {
  // Only the active pane mounts — the Notifications pane in particular fires a
  // batch of fetches on mount, so we never pay for panes the user isn't viewing.
  switch (id) {
    case 'get-started':
      return <GetStartedSection checklist={checklist} />;
    case 'profile':
      return <ProfileSection />;
    case 'general':
      return <GeneralSection />;
    case 'models':
      return <ModelsSection />;
    case 'voice':
      return <VoiceSection />;
    case 'browser':
      return <BrowserSection />;
    case 'connectors':
      return <ConnectorsSection />;
    case 'notifications':
      return <NotificationsSection />;
    case 'imports':
      return <ImportsSection />;
    case 'devices':
      return <DevicesSettingsSection />;
    case 'remote-preview':
      return <RemotePreviewSection />;
    default:
      return null;
  }
}

/**
 * The one settings surface. Mounted once in the dashboard shell; opened from
 * anywhere via `openSettings(section?)`. Centered dialog with a left side-nav
 * and a single scrollable content pane (the Claude/OpenAI pattern).
 */
export function SettingsModal() {
  const { open, section, autoLand } = useSettingsStore();
  const def = getSection(section);

  // Single source for setup state: drives the Get-started tab + count. Only
  // fetches while open.
  const checklist = useSetupChecklist(open);

  // The Get-started tab's visibility is decided ONCE per open (after data loads)
  // and stays sticky until close — so skipping the last item doesn't yank the
  // tab out from under you mid-session. `null` = not yet decided this session.
  const [showGetStarted, setShowGetStarted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open) {
      if (showGetStarted !== null) setShowGetStarted(null);
      return;
    }
    if (showGetStarted !== null || !checklist.ready) return;
    const shouldShow = checklist.showGetStarted;
    setShowGetStarted(shouldShow);
    // Generic open (gear/palette/mobile) → land on Get started while incomplete;
    // an explicit-section open (CTA/deep link) keeps its target.
    if (autoLand) {
      if (shouldShow) setSettingsSection('get-started');
      else consumeAutoLand();
    }
    // Reopened onto a now-hidden Get-started (everything got done/skipped last
    // session) → move off it. Only at decide-time, so it's never mid-session.
    if (!shouldShow && section === 'get-started') {
      setSettingsSection(DEFAULT_SECTION);
    }
  }, [open, showGetStarted, checklist.ready, checklist.showGetStarted, autoLand, section]);

  // Open from a `?settings=<id>` deep link on first mount.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('settings');
    if (isSectionId(param)) openSettings(param);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect open state + active section in the URL so the modal is linkable
  // and survives a refresh, without a router round-trip.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (open) params.set('settings', section);
    else params.delete('settings');
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(window.history.state, '', url);
  }, [open, section]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? openSettings() : closeSettings())}>
      <DialogContent
        className="flex h-[720px] max-h-[92vh] w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl sm:flex-row"
        // The panes own their own scroll; the dialog itself never scrolls.
      >
        <SettingsNav
          active={section}
          onSelect={setSettingsSection}
          getStarted={showGetStarted ? { done: checklist.doneCount, total: checklist.total } : null}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <DialogHeader className="gap-1 border-b border-border px-5 py-4 pr-12 text-left">
            <DialogTitle className="text-[15px] font-semibold">{def.title}</DialogTitle>
            <DialogDescription className="text-[12px] leading-snug">{def.description}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <SectionBody id={section} checklist={checklist} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
