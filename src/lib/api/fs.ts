import { api, ApiError } from './client';
import type { Attachment } from '@/db/types';

export interface FsBrowseEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file';
}

export interface FsBrowseResponse {
  path: string;
  parent: string | null;
  /** Realpath of the home directory — the picker's sandbox root. */
  home?: string;
  entries: FsBrowseEntry[];
}

export interface FsBrowseOptions {
  showHidden?: boolean;
  includeFiles?: boolean;
}

export type PickFolderResult =
  | { kind: 'picked'; path: string }
  | { kind: 'cancelled' }
  | { kind: 'unsupported'; reason: string };

export type DetectFaviconResult =
  | { kind: 'found'; attachment: Attachment; source: string }
  | { kind: 'none' };

/** Apps the local server can hand a folder off to. Mirrors the
 *  `OpenTarget` union on the server. */
export type OpenTarget =
  | 'finder'
  | 'terminal'
  | 'iterm'
  | 'vscode'
  | 'cursor'
  | 'antigravity'
  | 'zed'
  | 'sublime'
  | 'webstorm';

export type OpenInResult =
  | { ok: true }
  | { ok: false; reason: 'not_installed' | 'unsupported' | 'failed'; message?: string };

export interface InstalledApp {
  target: OpenTarget;
  label: string;
  /** Inline icon as a data URL (macOS only — extracted from the `.app`
   *  bundle). Null on other platforms or when extraction fails — caller
   *  falls back to a lucide icon. */
  iconDataUrl: string | null;
}

export interface InstalledAppsResponse {
  platform: NodeJS.Platform;
  apps: InstalledApp[];
}

export const fsApi = {
  browse(p?: string, opts?: FsBrowseOptions): Promise<FsBrowseResponse> {
    const query: Record<string, string> = {};
    if (p) query.path = p;
    if (opts?.showHidden) query.showHidden = '1';
    if (opts?.includeFiles) query.includeFiles = '1';
    return api.get<FsBrowseResponse>('/fs/browse', {
      query: Object.keys(query).length ? query : undefined,
    });
  },

  /**
   * Create a single subdirectory under `parent`. Name must be a single
   * path segment; server rejects slashes, `..`, and leading dots.
   */
  mkdir(parent: string, name: string): Promise<{ path: string }> {
    return api.post<{ path: string }>('/fs/mkdir', { parent, name });
  },

  /**
   * Open the OS native folder picker. The dialog opens on the same machine
   * the server runs on — i.e. the user's machine in a local-first setup.
   */
  async pickFolder(prompt?: string): Promise<PickFolderResult> {
    const res = await api.raw('/fs/pick-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (res.status === 204) return { kind: 'cancelled' };
    if (res.status === 501) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { kind: 'unsupported', reason: body.error ?? 'No native picker available' };
    }
    if (!res.ok) throw new Error(`pick-folder failed: ${res.status}`);
    const body = (await res.json()) as { path: string };
    return { kind: 'picked', path: body.path };
  },

  /**
   * Best-effort scan for a project favicon/icon under conventional paths.
   * On hit, the bytes are copied into the attachments dir and the resulting
   * `Attachment` record is returned.
   */
  detectFavicon(folderPath: string): Promise<DetectFaviconResult> {
    return api.post<DetectFaviconResult>('/fs/favicon', { path: folderPath });
  },

  /**
   * Detect installed editor/terminal apps on the user's machine. Includes
   * an inline data-URL icon for each app on macOS (extracted from the
   * `.app` bundle's `.icns`).
   */
  installedApps(): Promise<InstalledAppsResponse> {
    return api.get<InstalledAppsResponse>('/fs/installed-apps');
  },

  /**
   * Hand a folder to a native app on the user's machine — file manager,
   * terminal, or one of the common code editors. Server detaches the
   * spawned process and returns immediately. App-not-installed comes
   * back as a structured `{ ok: false, reason: 'not_installed' }`
   * rather than throwing — caller can show a friendly toast.
   */
  async openIn(folderPath: string, target: OpenTarget): Promise<OpenInResult> {
    try {
      await api.post<{ ok: true }>('/fs/open', { path: folderPath, target });
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { reason?: string; message?: string } | null;
        const reason = body?.reason;
        if (reason === 'not_installed' || reason === 'unsupported' || reason === 'failed') {
          return { ok: false, reason, message: body?.message };
        }
      }
      throw err;
    }
  },
};
