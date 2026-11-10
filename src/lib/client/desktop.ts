import type { DesktopNotificationAction, DesktopNotificationStatus } from '@/lib/notifications/desktop-contract';
import type { DesktopSettingsAction, DesktopSettingsStatus } from './desktop-settings';
import type { DesktopConnectionAction, DesktopConnectionState } from '@/lib/connection/desktop-contract';
import type { DesktopDeviceSettingsAction, DesktopDeviceSettingsStatus } from './desktop-device-settings';

export type DesktopComputerAction = { type: 'status' } | { type: 'keep-running'; on: boolean } | { type: 'add-to-terminal' };
export interface DesktopComputerStatus { appVersion: string; keepRunning: boolean; canKeepRunning: boolean; message?: string }

export interface RiDesktop {
  platform: string;
  openExternal(url: string): Promise<void>;
  onResume(callback: () => void): () => void;
  onPrepareClose(callback: () => Promise<boolean>): () => void;
  onPrepareBackground(callback: () => boolean): () => void;
  onQuickCapture(callback: () => void): () => void;
  connection?(action: DesktopConnectionAction): Promise<DesktopConnectionState>;
  onConnectionChange?(callback: (state: DesktopConnectionState) => void): () => void;
  settings?(action: DesktopSettingsAction): Promise<DesktopSettingsStatus>;
  /** This computer's controls, including while viewing a Home elsewhere. Changes retain native consent. */
  deviceSettings?(action: DesktopDeviceSettingsAction): Promise<DesktopDeviceSettingsStatus>;
  onOpenSettings?(callback: () => void): () => void;
  /** Settings > This computer, for a Home on this computer. */
  computer?(action: DesktopComputerAction): Promise<DesktopComputerStatus>;
  /** Fixed Install and Sign in buttons for a coding tool, for a Home on this computer. */
  setupHarness?(request: { harness: 'claude' | 'codex'; action: 'install' | 'login' }): Promise<void>;
  /** Read-only status for this computer, including its local consent. */
  notificationStatus?(): Promise<DesktopNotificationStatus>;
  /** Change this computer's notifications. From a connected Home, the desktop asks the person natively before turning them on. */
  notifications?(action: DesktopNotificationAction): Promise<DesktopNotificationStatus>;
  /** Open the computer's notification settings (System Settings on macOS). */
  openNotificationSettings?(): Promise<void>;
}

declare global { interface Window { riDesktop?: RiDesktop } }

export async function openIntegrationAuthorization(url: string) {
  if (window.riDesktop) await window.riDesktop.openExternal(url);
  else window.location.assign(url);
}
