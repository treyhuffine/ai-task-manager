import type { DesktopDeviceSettingsAction, DesktopDeviceSettingsStatus } from '../src/lib/client/desktop-device-settings';
import type { CompanionAction } from './companion-window';
import { desktopSettingsAction } from './settings';

const simple = ['status', 'enable-worker', 'stop-worker', 'resume-worker', 'update-check', 'update-download', 'update-apply', 'update-later', 'connection', 'recovery'];

export function deviceSettingsAction(raw: unknown): DesktopDeviceSettingsAction {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid desktop settings request');
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(',');
  if (keys === 'type' && typeof value.type === 'string' && simple.includes(value.type)) return value as DesktopDeviceSettingsAction;
  if (keys === 'type,value' && value.type === 'preferences') return { type: 'preferences', value: desktopSettingsAction(value.value) };
  if (keys === 'enabled,type' && value.type === 'login' && typeof value.enabled === 'boolean') return { type: 'login', enabled: value.enabled };
  throw new Error('Invalid desktop settings request');
}

/** The person's native answer remains authoritative for a connected Home's changes.
 * Enrollment and Stop already ask in the shared companion action handler. */
export function deviceSettingsRequests(deps: {
  local(): boolean;
  status(): Promise<DesktopDeviceSettingsStatus>;
  request(action: CompanionAction, value?: unknown): Promise<unknown>;
  openConnection(): Promise<void>;
  confirm(message: string, detail: string): Promise<boolean>;
}) {
  let busy = false;
  return async (raw: unknown): Promise<DesktopDeviceSettingsStatus> => {
    const action = deviceSettingsAction(raw);
    if (action.type === 'status') return deps.status();
    if (busy) throw new Error('Wait for the current desktop action to finish.');
    busy = true;
    try {
      const confirmation = {
        'resume-worker': ['Resume agents on this computer?', 'Your Ri can send work here again, using this computer’s tools and sign-ins.'],
        preferences: ['Change desktop preferences on this computer?', 'This changes this computer’s global capture shortcut or desktop login preference.'],
        login: ['Change background startup on this computer?', 'This changes whether this computer’s Ri service starts when you log in.'],
        'update-apply': ['Update Ri on this computer?', 'The verified update is applied when local work is idle. Your remote Ri keeps running.'],
      }[action.type as 'resume-worker' | 'preferences' | 'login' | 'update-apply'];
      if (!deps.local() && confirmation && !(await deps.confirm(confirmation[0], confirmation[1]))) return deps.status();
      if (action.type === 'connection') await deps.openConnection();
      else if (action.type === 'preferences') await deps.request('preferences', action.value);
      else if (action.type === 'login') await deps.request('login', { enabled: action.enabled });
      else await deps.request(action.type);
      return await deps.status();
    } finally { busy = false; }
  };
}
