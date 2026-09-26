'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { THIS_COMPUTER_STORAGE_KEY } from '@/constants/app';
import { useClientLocation } from '@/hooks/use-client-location';
import { useSession } from '@/hooks/use-execution';
import { useRunOn } from '@/hooks/use-workspaces';
import { fsApi, type InstalledAppsResponse, type OpenInClientOptions, type OpenInResult, type OpenTarget } from '@/lib/api/fs';
import { openApi } from '@/lib/api/open';
import { folderApiBase, type FolderSource } from '@/lib/folders/source';

/**
 * How this browser opens a folder's files in an app (P3.5, spec §3.3). An
 * app opens files on the computer they're on, for the person at that
 * computer:
 *
 *   - files at home, in a browser on the home's computer: the home opens
 *     them, as before (`/api/fs/open`)
 *   - files on another computer, in a browser linked to that computer
 *     ("This Mac", P2.2): that computer's worker opens them
 *   - anywhere else: nothing opens, and `filesOn` says where they are
 */
export interface Opener {
  /** `here` is the home opening its own files. `worker` is another computer's worker. */
  via: 'here' | 'worker';
  /** Cache key for the apps installed where things open. */
  appsKey: readonly unknown[];
  apps(): Promise<InstalledAppsResponse>;
  /** Open a path inside the folder, as the UI knows it: absolute, under the folder's root. */
  open(absPath: string, target: OpenTarget, opts?: OpenInClientOptions): Promise<OpenInResult>;
}

export interface OpenerState {
  opener: Opener | null;
  /** The computer the files are on, when this browser can't open them. */
  filesOn: string | null;
}

interface ThisComputer {
  id: string;
  name: string;
}

function readThisComputer(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(THIS_COMPUTER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

/** The computer this browser was linked to, if any. The home checks it again on every open. */
export function useThisComputer(): ThisComputer | null {
  const raw = useSyncExternalStore(subscribeStorage, readThisComputer, () => null);
  return useMemo(() => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<ThisComputer>;
      return parsed.id && parsed.name ? { id: parsed.id, name: parsed.name } : null;
    } catch {
      return null;
    }
  }, [raw]);
}

const HOME_OPENER: Opener = {
  via: 'here',
  appsKey: ['fs', 'installed-apps'],
  apps: () => fsApi.installedApps(),
  open: (absPath, target, opts) => fsApi.openIn(absPath, target, opts),
};

function relativeTo(root: string, absPath: string): string | null {
  const base = root.replace(/\/+$/, '');
  if (absPath === base) return null;
  return absPath.startsWith(`${base}/`) ? absPath.slice(base.length + 1) : absPath;
}

/**
 * The opener for a folder. With no source (a surface that predates this),
 * the folder is taken to be the home's, as it was.
 */
export function useOpener(source: FolderSource | null, root: string | null): OpenerState {
  const client = useClientLocation();
  const thisComputer = useThisComputer();
  const { data: session } = useSession(source?.kind === 'session' ? source.sessionId : null);
  const { data: runOn } = useRunOn(source?.kind === 'workspace' ? source.workspaceId : null);

  return useMemo<OpenerState>(() => {
    const where = !source
      ? { known: true, isHome: true, computerId: null as string | null, name: null as string | null }
      : source.kind === 'session'
        ? session
          ? {
              known: true,
              isHome: session.location?.isHome ?? true,
              computerId: session.location?.computerId ?? null,
              name: session.location?.name ?? null,
            }
          : { known: false, isHome: true, computerId: null, name: null }
        : runOn
          ? {
              known: true,
              isHome: runOn.livesOn?.isHome ?? true,
              computerId: runOn.livesOn?.computerId ?? null,
              name: runOn.livesOn?.name ?? null,
            }
          : { known: false, isHome: true, computerId: null, name: null };
    if (!where.known) return { opener: null, filesOn: null };
    if (where.isHome) return client.kind === 'host' ? { opener: HOME_OPENER, filesOn: null } : { opener: null, filesOn: where.name };
    if (!source || !where.computerId || thisComputer?.id !== where.computerId || !root) {
      return { opener: null, filesOn: where.name };
    }
    const base = folderApiBase(source);
    return {
      filesOn: null,
      opener: {
        via: 'worker',
        appsKey: ['computers', where.computerId, 'installed-apps'],
        apps: () => openApi.apps(base),
        open: (absPath, target, opts = {}) => {
          const { projectDir: _ignored, ...rest } = opts;
          void _ignored;
          return openApi.open(base, relativeTo(root, absPath), target, rest);
        },
      },
    };
  }, [client.kind, root, runOn, session, source, thisComputer]);
}
