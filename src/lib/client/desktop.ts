import type { DesktopNotificationAction, DesktopNotificationStatus } from '@/lib/notifications/desktop-contract';
import type { DesktopSettingsAction, DesktopSettingsStatus } from './desktop-settings';
import type { DesktopConnectionAction, DesktopConnectionState } from '@/lib/connection/desktop-contract';

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
  /** Read-only status for this computer, including its local consent. */
  notificationStatus?(): Promise<DesktopNotificationStatus>;
  notifications?(action: DesktopNotificationAction): Promise<DesktopNotificationStatus>;
}

declare global { interface Window { riDesktop?: RiDesktop } }

export async function openIntegrationAuthorization(url: string) {
  if (window.riDesktop) await window.riDesktop.openExternal(url);
  else window.location.assign(url);
}
