import type { RollbackStatus, UpdateRecord } from './update';
import type { MaintenanceWindow } from './update-settings';

export function maintenanceWindowText(window: MaintenanceWindow) {
  const time = (hour: number) => `${String(hour % 24).padStart(2, '0')}:00`;
  return `between ${time(window.hour)} and ${time(window.hour + window.durationHours)} (${window.timeZone})`;
}

/** What a waiting update is waiting for, as Settings and `ri status` say it (7.1). */
export function updateWaitingText(update: Pick<UpdateRecord, 'reason' | 'headsUpAt' | 'heldUntil'>, now = Date.now()) {
  if (update.headsUpAt) return 'Ri will update in 1 minute';
  if (update.heldUntil && Date.parse(update.heldUntil) > now) return `You asked to update later. Ri asks again when it's quiet after ${new Date(update.heldUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const reason = (update.reason ?? 'the service to be idle').replace(/^waiting for /i, '').replace(/\.$/, '');
  // Counts of running work finish. Anything else is only waited for.
  return /^\d+ /.test(reason) ? `Waiting for ${reason} to finish` : `Waiting for ${reason}`;
}

/**
 * The rail's row while an installed update waits on running work, or null.
 * Only for people who can act on updates, and only while one waits: what it
 * says is what Settings and `ri status` say (`updateWaitingText`).
 */
export function railUpdateNotice(status: { canUseUpdates: boolean; update?: Pick<UpdateRecord, 'phase' | 'reason' | 'headsUpAt' | 'heldUntil'> } | undefined, now = Date.now()): string | null {
  if (!status?.canUseUpdates || status.update?.phase !== 'waiting') return null;
  return updateWaitingText(status.update, now);
}

export function updateStatusText(update: UpdateRecord & { busy?: boolean }) {
  if (update.phase === 'downloading') return (update.bytes ?? 0) >= (update.release?.runtime.size ?? Infinity) ? 'Verifying and preparing the downloaded runtime…' : 'Downloading update…';
  if (update.phase === 'waiting') return updateWaitingText(update);
  const phases: Record<UpdateRecord['phase'], string> = {
    idle: update.busy ? 'Checking for updates…' : 'Up to date',
    available: 'Update available', downloading: 'Downloading update…', ready: 'Downloaded and verified',
    waiting: 'Waiting for work to finish', draining: 'Waiting for active work and saving changes…',
    checkpointing: 'Backing up your data…', validating: 'Applying and checking database migrations…',
    committed: 'Up to date', failed: 'Update needs attention', 'recovery-required': 'Recovery required',
  };
  return phases[update.phase];
}

export function updateProgress(update: UpdateRecord) {
  if (update.phase !== 'downloading') return null;
  const total = update.release?.runtime.size;
  const bytes = Math.max(0, Math.min(update.bytes ?? 0, total ?? Infinity));
  const mib = (value: number) => (value / 1024 ** 2).toFixed(1);
  return {
    percent: total ? Math.min(100, Math.floor(bytes / total * 100)) : undefined,
    text: total ? `${mib(bytes)} of ${mib(total)} MiB downloaded` : `${mib(bytes)} MiB downloaded`,
  };
}

/** What going back one release would lose, shown before anyone confirms it (7.6). */
export function describeRollback(rootLabel: string, state: RollbackStatus) {
  if (!state.available) return state.reason ?? 'Rollback is not available.';
  const changes = state.changes;
  const lost = changes ? [
    changes.messages && `${changes.messages} chat message${changes.messages === 1 ? '' : 's'}`,
    changes.chats && `${changes.chats} chat${changes.chats === 1 ? '' : 's'} changed`,
    changes.tasks && `${changes.tasks} task${changes.tasks === 1 ? '' : 's'} changed`,
    changes.notes && `${changes.notes} note${changes.notes === 1 ? '' : 's'} changed`,
  ].filter(Boolean) : [];
  return [
    `Roll ${rootLabel} back to the version it ran before the update at ${new Date(state.createdAt!).toLocaleString()}?`,
    lost.length ? `Everything written since then would be lost: ${lost.join(', ')}.` : 'Nothing has been written since then.',
    'Work the newer version already did, such as a message it sent, may happen again, because the restored records no longer show it.',
    'Any chat still running ends when it restarts.',
    `Rollback is possible until ${new Date(state.expiresAt!).toLocaleString()}.`,
  ].join('\n');
}
