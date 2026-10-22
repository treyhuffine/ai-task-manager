import type { DesktopNotificationAction, DesktopNotificationStatus } from '../src/lib/notifications/desktop-contract';

interface Dependencies {
  /** Ask the person in a native dialog. The page can neither draw nor answer it. */
  confirm(): Promise<boolean>;
  /** This computer's stored consent for the connected Home. */
  permitted(): boolean;
  change(kind: Exclude<DesktopNotificationAction, 'status'>): Promise<DesktopNotificationStatus>;
  status(): Promise<DesktopNotificationStatus>;
}

/**
 * Notification changes a connected Home's page asks for, in place. The page may ask to turn
 * alerts on, but only the person grants it, in the native dialog, so a Home preference alone
 * still never enables presentation on this computer. Turning off needs no confirmation. A test
 * needs consent already given. One dialog at a time, however often the page asks.
 */
export function remoteNotificationChanges(deps: Dependencies) {
  let asking: Promise<boolean> | undefined;
  return async (kind: DesktopNotificationAction): Promise<DesktopNotificationStatus> => {
    if (kind === 'status') return deps.status();
    if (kind === 'enable' && !deps.permitted()) {
      asking ??= deps.confirm().catch(() => false).finally(() => { asking = undefined; });
      if (!(await asking)) return deps.status();
    }
    if (kind === 'test' && !deps.permitted()) throw new Error('Turn on desktop notifications on this computer first.');
    return deps.change(kind);
  };
}
