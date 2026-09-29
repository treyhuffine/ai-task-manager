import type { UpdateRecord } from './update';
import type { MaintenanceWindow } from './update-settings';

export function maintenanceWindowText(window: MaintenanceWindow) {
  const time = (hour: number) => `${String(hour % 24).padStart(2, '0')}:00`;
  return `between ${time(window.hour)} and ${time(window.hour + window.durationHours)} (${window.timeZone})`;
}

export function updateStatusText(update: UpdateRecord & { busy?: boolean }) {
  if (update.phase === 'downloading') return (update.bytes ?? 0) >= (update.release?.runtime.size ?? Infinity) ? 'Verifying and preparing the downloaded runtime…' : 'Downloading update…';
  if (update.phase === 'waiting') return update.reason ?? 'Waiting for work to finish';
  const phases: Record<UpdateRecord['phase'], string> = {
    idle: update.busy ? 'Checking for updates…' : update.release ? 'You are up to date' : 'Ready to check for updates',
    available: 'Update available', downloading: 'Downloading update…', ready: 'Downloaded and verified',
    waiting: 'Waiting for work to finish', draining: 'Waiting for active work and saving changes…',
    checkpointing: 'Backing up your data…', validating: 'Applying and checking database migrations…',
    committed: 'Updated successfully', failed: 'Update needs attention', 'recovery-required': 'Recovery required',
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
