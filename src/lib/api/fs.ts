import { isHostnameClaimed } from '@/hooks/use-client-location';
import { trpcClient } from '@/lib/trpc/client';
import { rpcOptions, rpcQuery } from '@/lib/trpc/request-options';
import type { RouterInputs, RouterOutputs } from '@/lib/trpc/router';
import { apiErrorBody, apiErrorStatus } from './client';

/** Loopback hostnames that imply the browser is on the host machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Whether this browser is the app's host machine — loopback, or a hostname
 * the user explicitly claimed (Tailscale/LAN) in settings. Mirrors
 * `useClientLocation().kind === 'host'`, which is the same condition the UI
 * uses to show the open/reveal affordances. We send this to `/api/fs/open`
 * so the server's locality gate agrees with the client instead of rejecting
 * a legitimately-claimed host.
 */
export function clientIsHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return LOOPBACK_HOSTS.has(h) || isHostnameClaimed(h);
}

export type FsBrowseEntry = RouterOutputs['fs']['browseGet']['entries'][number];

export type FsBrowseResponse = RouterOutputs['fs']['browseGet'];

export interface FsBrowseOptions {
  showHidden?: boolean;
  includeFiles?: boolean;
}

export type PickFolderResult =
  | { kind: 'picked'; path: string }
  | { kind: 'cancelled' }
  | { kind: 'unsupported'; reason: string };

export type DetectFaviconResult = RouterOutputs['fs']['faviconPost'];

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

export type OpenInResult = RouterOutputs['sessions']['openPost'];

export interface OpenInClientOptions {
  /** 1-based line to jump to (editors that support it). */
  line?: number;
  /** 1-based column (used with `line`). */
  column?: number;
  /** Reveal/select the path in the file manager instead of opening it. */
  reveal?: boolean;
  /** Project root to open alongside the file so the editor's tree loads. */
  projectDir?: string;
}

export type InstalledApp = RouterOutputs['fs']['installedAppsGet']['apps'][number];

export type InstalledAppsResponse = RouterOutputs['fs']['installedAppsGet'];

/**
 * POST to `/fs/open`, mapping the structured 422 "couldn't open" body
 * (`{ reason, message }`) into an `OpenInResult` instead of throwing. Any
 * other failure (403 remote-forbidden, 404, 500) still throws.
 */
async function postOpen(body: RouterInputs['fs']['openPost']['body']): Promise<OpenInResult> {
  try {
    await trpcClient.fs.openPost.mutate({body: body}, rpcOptions(clientIsHost() ? { headers: { 'x-ri-host': '1' } } : undefined));
    return { ok: true };
  } catch (err) {
    if (apiErrorStatus(err) === 422) {
      const b = apiErrorBody<{ reason?: string; message?: string }>(err);
      const reason = b?.reason;
      if (reason === 'not_installed' || reason === 'unsupported' || reason === 'failed') {
        return { ok: false, reason, message: b?.message };
      }
    }
    throw err;
  }
}

export const fsApi = {
  browse(p?: string, opts?: FsBrowseOptions) {
    const query: Record<string, string> = {};
    if (p) query.path = p;
    if (opts?.showHidden) query.showHidden = '1';
    if (opts?.includeFiles) query.includeFiles = '1';
    return trpcClient.fs.browseGet.query({query: rpcQuery(Object.keys(query).length ? query : undefined)});
  },

  /**
   * Create a single subdirectory under `parent`. Name must be a single
   * path segment; server rejects slashes, `..`, and leading dots.
   */
  mkdir(parent: string, name: string) {
    return trpcClient.fs.mkdirPost.mutate({body: { parent, name }});
  },

  /**
   * Open the OS native folder picker. The dialog opens on the same machine
   * the server runs on — i.e. the user's machine in a local-first setup.
   */
  async pickFolder(prompt?: string) {
    return trpcClient.fs.pickFolderPost.mutate({ body: { prompt } });
  },

  /**
   * Best-effort scan for a project favicon/icon under conventional paths.
   * On hit, the bytes are copied into the attachments dir and the resulting
   * `Attachment` record is returned.
   */
  detectFavicon(folderPath: string) {
    return trpcClient.fs.faviconPost.mutate({body: { path: folderPath }});
  },

  /**
   * Detect installed editor/terminal apps on the user's machine. Includes
   * an inline data-URL icon for each app on macOS (extracted from the
   * `.app` bundle's `.icns`).
   */
  installedApps() {
    return trpcClient.fs.installedAppsGet.query({});
  },

  /**
   * Hand a folder to a native app on the user's machine — file manager,
   * terminal, or one of the common code editors. Server detaches the
   * spawned process and returns immediately. App-not-installed comes
   * back as a structured `{ ok: false, reason: 'not_installed' }`
   * rather than throwing — caller can show a friendly toast.
   */
  openIn(folderPath: string, target: OpenTarget, opts?: OpenInClientOptions): Promise<OpenInResult> {
    return postOpen({ path: folderPath, target, ...opts });
  },

  /**
   * Open a path with the user's custom editor command (vim/nvim/emacs/…).
   * The server substitutes `{file}`/`{line}`/`{column}`/`{dir}` and spawns
   * it (args array, no shell). Same locality + home confinement as `openIn`.
   */
  openWithCommand(
    folderPath: string,
    command: string,
    opts?: OpenInClientOptions,
  ): Promise<OpenInResult> {
    return postOpen({ path: folderPath, target: 'custom', command, ...opts });
  },
};
