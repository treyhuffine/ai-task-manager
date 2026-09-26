/**
 * The known editors and terminals installed on this computer, each with its
 * real icon where the platform gives one (macOS). Answered by the home for a
 * browser on its own computer (`GET /api/fs/installed-apps`) and by a worker
 * for a browser on the computer it runs on (P3.5).
 */

import { detectInstalledApps, type DetectedApp } from './detect-apps';
import { extractAppIconPng } from './extract-icon';

export interface InstalledAppEntry {
  target: DetectedApp['target'];
  label: string;
  /** `data:image/png;base64,…` when the platform supports icon
   *  extraction (macOS) and the bundle yielded an icon, otherwise null. */
  iconDataUrl: string | null;
}

export interface InstalledAppsResponse {
  platform: NodeJS.Platform;
  apps: InstalledAppEntry[];
}

export async function listInstalledApps(): Promise<InstalledAppsResponse> {
  const detected = await detectInstalledApps();
  const apps: InstalledAppEntry[] = await Promise.all(
    detected.map(async (app) => {
      let iconDataUrl: string | null = null;
      if (app.source && process.platform === 'darwin' && app.source.endsWith('.app')) {
        const png = await extractAppIconPng(app.source);
        if (png) iconDataUrl = `data:image/png;base64,${png.toString('base64')}`;
      }
      return { target: app.target, label: app.label, iconDataUrl };
    }),
  );
  return { platform: process.platform, apps };
}
