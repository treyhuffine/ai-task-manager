import { api } from './client';
import type { InstalledAppsResponse, OpenInClientOptions, OpenInResult, OpenTarget } from './fs';

/**
 * Opening a folder in an app on the computer it's on, through that
 * computer's worker, for a browser on that computer (P3.5). Every call takes
 * the folder's route base (`folderApiBase`) and a path inside the folder.
 */
export const openApi = {
  apps(base: string): Promise<InstalledAppsResponse> {
    return api.post<InstalledAppsResponse>(`${base}/open`, { op: 'apps' });
  },
  async open(base: string, relPath: string | null, target: OpenTarget, opts: Omit<OpenInClientOptions, 'projectDir'> = {}): Promise<OpenInResult> {
    const res = await api.post<{ ok: boolean; reason?: 'not_installed' | 'unsupported' | 'failed'; message?: string }>(`${base}/open`, {
      op: 'open',
      path: relPath,
      target,
      ...opts,
    });
    return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? 'failed', message: res.message };
  },
};
