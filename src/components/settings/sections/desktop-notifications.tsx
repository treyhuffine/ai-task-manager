'use client';

import { AlertCircle, CheckCircle2, Loader2, Monitor } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DesktopNotificationStatus } from '@/lib/notifications/desktop-contract';
import { cn } from '@/lib/utils';

interface Props {
  status: DesktopNotificationStatus | null;
  checking: boolean;
  error?: string | null;
  busy: boolean;
  localControls: boolean;
  canOpenSettings: boolean;
  /** macOS turns notifications from this build away without asking: it has no Apple-issued signature. */
  needsSignedBuild?: boolean;
  /** A Telegram channel is on, so alerts still reach the person. */
  telegramReady?: boolean;
  /** The desktop can open the computer's own notification settings. */
  canOpenSystemSettings?: boolean;
  onToggle(): void;
  onOpenSettings(): void;
  onCheck(): void;
  onOpenSystemSettings?(): void;
  onUseTelegram?(): void;
}

/** A refusal the person fixes in macOS System Settings, as worded by the desktop app. */
const BLOCKED_BY_SYSTEM = /System Settings/;

/** This computer's consent is separate from the shared delivery channels. */
export function DesktopNotifications({
  status, checking, error, busy, localControls, canOpenSettings, needsSignedBuild, telegramReady, canOpenSystemSettings,
  onToggle, onOpenSettings, onCheck, onOpenSystemSettings, onUseTelegram,
}: Props) {
  if (needsSignedBuild && !checking) return <UnsignedBuild telegramReady={!!telegramReady} onUseTelegram={onUseTelegram} />;

  const issue = error || status?.error;
  const enabled = !!status?.enabled && status.supported && !issue;
  const unsupported = status?.supported === false;
  const label = checking ? 'Checking…' : issue ? 'Needs attention' : unsupported ? 'Unavailable' : !status ? 'Check setup' : enabled ? 'On' : 'Off';
  const needsSetup = !checking && !enabled && !unsupported;
  const systemFix = !!issue && BLOCKED_BY_SYSTEM.test(issue) && canOpenSystemSettings && onOpenSystemSettings;

  return (
    <section aria-label="Desktop notifications on this computer" className={cn(
      'space-y-3 rounded-xl border p-4',
      needsSetup ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-card/30',
    )}>
      <div className="flex items-start gap-3">
        <Monitor size={20} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Desktop notifications</h3>
            <Badge variant="outline" role="status" className={cn(
              'gap-1 rounded-full text-[10px]',
              enabled && !checking && 'border-emerald-500/25 text-emerald-700 dark:text-emerald-400',
              needsSetup && 'border-amber-500/30 text-amber-700 dark:text-amber-400',
            )}>
              {checking ? <Loader2 size={11} className="animate-spin" /> : enabled ? <CheckCircle2 size={11} /> : needsSetup ? <AlertCircle size={11} /> : null}
              {label}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {checking ? 'Checking notifications on this computer.'
              : issue ? 'Check this computer’s notification settings to restore alerts.'
              : unsupported ? 'Desktop notifications are unavailable on this computer.'
              : enabled ? 'Enabled on this computer. Keep Ri running in the menu bar.'
              : !status ? 'Review notification permissions for this computer.'
              : 'Get alerts here when an agent needs you or finishes a chat.'}
          </p>
        </div>
      </div>

      {issue && <p role="alert" className="text-xs text-destructive">{issue}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {systemFix ? (
          <Button size="sm" onClick={onOpenSystemSettings}>Open Notification Settings</Button>
        ) : localControls && status && (!unsupported || status.enabled) ? (
          <Button size="sm" variant={status.enabled ? 'outline' : 'default'} disabled={busy || checking || !!error} onClick={onToggle}>
            {status.enabled ? 'Disable desktop notifications' : 'Enable desktop notifications'}
          </Button>
        ) : canOpenSettings ? (
          <Button size="sm" variant={enabled || unsupported ? 'outline' : 'default'} disabled={busy || checking} onClick={onOpenSettings}>
            {enabled || unsupported || issue ? 'Open notification settings' : 'Enable desktop notifications'}
          </Button>
        ) : (
          <p className="text-xs font-medium">Open Tools, then Ri on This Device, then Notifications on this computer.</p>
        )}
        {issue && <Button size="sm" variant="ghost" disabled={busy || checking} onClick={onCheck}>Check again</Button>}
      </div>
      {enabled && <p className="text-[11px] text-muted-foreground">Use Test on the Desktop channel below to check delivery.</p>}
      {needsSetup && !issue && <p className="text-[11px] text-muted-foreground">Keep Ri running in the menu bar to receive alerts.</p>}
    </section>
  );
}

/** Nothing on this computer can turn notifications on, so say why and where alerts still arrive. */
function UnsignedBuild({ telegramReady, onUseTelegram }: { telegramReady: boolean; onUseTelegram?: () => void }) {
  return (
    <section aria-label="Desktop notifications on this computer" className="space-y-3 rounded-xl border border-border bg-card/30 p-4">
      <div className="flex items-start gap-3">
        <Monitor size={20} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Desktop notifications</h3>
            <Badge variant="outline" role="status" className="rounded-full text-[10px]">Not in this build</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            macOS shows notifications only from apps signed with an Apple Developer ID. This build of Ri isn’t signed yet, so macOS
            turns its notifications away without asking, and Ri won’t appear in System Settings.
          </p>
          <p className="text-xs text-muted-foreground">
            {telegramReady
              ? 'Your Telegram channel still reaches you. Browser push works too if you open Ri in Chrome or Safari on this Mac.'
              : 'Telegram reaches you anywhere, and browser push works if you open Ri in Chrome or Safari on this Mac.'}
          </p>
        </div>
      </div>
      {!telegramReady && onUseTelegram && <Button size="sm" onClick={onUseTelegram}>Set up Telegram</Button>}
    </section>
  );
}
