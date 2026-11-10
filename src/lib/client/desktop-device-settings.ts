import type { DesktopSettingsAction, DesktopSettingsStatus } from './desktop-settings';
import type { ServiceRole } from '../service/role';
import type { ServiceWorkerStatus } from '../service/worker';
import type { UpdateCoordinator } from '../service/update';

/** Fixed requests only. A connected Home cannot supply native commands or paths. */
export type DesktopDeviceSettingsAction =
  | { type: 'status' | 'enable-worker' | 'stop-worker' | 'resume-worker' | 'update-check' | 'update-download' | 'update-apply' | 'update-later' | 'connection' | 'recovery' }
  | { type: 'preferences'; value: DesktopSettingsAction }
  | { type: 'login'; enabled: boolean };

export interface DesktopDeviceSettingsStatus {
  role: ServiceRole['role'];
  appVersion: string;
  runtimeVersion?: string;
  home: { name: string; hostName: string | null } | null;
  serviceAvailable: boolean;
  startsAtLogin: boolean;
  preferences: DesktopSettingsStatus | null;
  worker?: Pick<ServiceWorkerStatus, 'state' | 'enabled' | 'reason' | 'error'>;
  update: Pick<ReturnType<UpdateCoordinator['status']>, 'phase' | 'configured' | 'reason' | 'error'> | null;
}
