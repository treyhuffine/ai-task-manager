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
  onToggle(): void;
  onOpenSettings(): void;
  onCheck(): void;
}

/** This computer's consent is separate from the shared delivery channels. */
export function DesktopNotifications({ status, checking, error, busy, localControls, canOpenSettings, onToggle, onOpenSettings, onCheck }: Props) {
  const issue = error || status?.error;
  const enabled = !!status?.enabled && status.supported && !issue;
  const unsupported = status?.supported === false;
  const label = checking ? 'Checking…' : issue ? 'Needs attention' : unsupported ? 'Unavailable' : !status ? 'Check setup' : enabled ? 'On' : 'Off';
  const needsSetup = !checking && !enabled && !unsupported;

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
        {localControls && status && (!unsupported || status.enabled) ? (
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
