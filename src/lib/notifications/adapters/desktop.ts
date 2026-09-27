import type { NotificationChannelAdapter } from '../types';
import { isDesktopNotificationChannel } from '../desktop-contract';

/** Persisted by notify(), claimed and acknowledged by the authenticated local
 * Electron process. No renderer or external push subscription sends it. */
export const desktopAdapter: NotificationChannelAdapter = {
  kind: 'in_app',
  validateConfig(channel) {
    if (!isDesktopNotificationChannel(channel)) throw new Error('Unsupported in-app notification destination');
  },
  async deliver() { return { deferred: true }; },
};
