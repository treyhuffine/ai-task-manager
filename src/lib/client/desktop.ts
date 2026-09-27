import type { DesktopNotificationAction, DesktopNotificationStatus } from '@/lib/notifications/desktop-contract';

export interface RiDesktop {
  platform: string;
  openExternal(url: string): Promise<void>;
  onResume(callback: () => void): () => void;
  onPrepareClose(callback: () => Promise<boolean>): () => void;
  onPrepareBackground(callback: () => boolean): () => void;
  notifications(action: DesktopNotificationAction): Promise<DesktopNotificationStatus>;
}

declare global { interface Window { riDesktop?: RiDesktop } }

export async function openConnectorAuthorization(url: string) {
  if (window.riDesktop) await window.riDesktop.openExternal(url);
  else window.location.assign(url);
}
