'use client';

import { useMemo } from 'react';
import { useClientLocation } from '@/hooks/use-client-location';
import { useThisDevice } from '@/hooks/use-devices';
import { useSession } from '@/hooks/use-execution';
import { useRunOn } from '@/hooks/use-workspaces';
import { fsApi, type InstalledAppsResponse, type OpenInClientOptions, type OpenInResult, type OpenTarget } from '@/lib/api/fs';
import { openApi } from '@/lib/api/open';
import { folderApiBase, type FolderSource } from '@/lib/folders/source';

/**
 * How this browser opens a folder's files in an app (P3.5, spec §3.3). An
 * app opens files on the device they're on, for the person at that
 * device:
 *
 *   - files at home, in a browser on the home's device: the home opens
 *     them, as before (`/api/fs/open`)
 *   - files on another device, in a browser linked to that device
 *     ("This Mac", P2.2): that device's worker opens them
 *   - anywhere else: nothing opens, and `filesOn` says where they are
 */
export interface Opener {
  /** `here` is the home opening its own files. `worker` is another device's worker. */
  via: 'here' | 'worker';
  /** Cache key for the apps installed where things open. */
  appsKey: readonly unknown[];
  apps(): Promise<InstalledAppsResponse>;
  /** Open a path inside the folder, as the UI knows it: absolute, under the folder's root. */
  open(absPath: string, target: OpenTarget, opts?: OpenInClientOptions): Promise<OpenInResult>;
}

export interface OpenerState {
  opener: Opener | null;
  /** The device the files are on, when this browser can't open them. */
  filesOn: string | null;
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
  const thisDevice = useThisDevice();
  const { data: session } = useSession(source?.kind === 'session' ? source.sessionId : null);
  const { data: runOn } = useRunOn(source?.kind === 'workspace' ? source.workspaceId : null);

  return useMemo<OpenerState>(() => {
    const where = !source
      ? { known: true, isHome: true, deviceId: null as string | null, name: null as string | null }
      : source.kind === 'session'
        ? session
          ? {
              known: true,
              isHome: session.location?.isHome ?? true,
              deviceId: session.location?.deviceId ?? null,
              name: session.location?.name ?? null,
            }
          : { known: false, isHome: true, deviceId: null, name: null }
        : runOn
          ? {
              known: true,
              isHome: runOn.livesOn?.isHome ?? true,
              deviceId: runOn.livesOn?.deviceId ?? null,
              name: runOn.livesOn?.name ?? null,
            }
          : { known: false, isHome: true, deviceId: null, name: null };
    if (!where.known) return { opener: null, filesOn: null };
    if (where.isHome) return client.kind === 'host' ? { opener: HOME_OPENER, filesOn: null } : { opener: null, filesOn: where.name };
    if (!source || !where.deviceId || thisDevice?.id !== where.deviceId || !root) {
      return { opener: null, filesOn: where.name };
    }
    const base = folderApiBase(source);
    return {
      filesOn: null,
      opener: {
        via: 'worker',
        appsKey: ['devices', where.deviceId, 'installed-apps'],
        apps: () => openApi.apps(base),
        open: (absPath, target, opts = {}) => {
          const { projectDir: _ignored, ...rest } = opts;
          void _ignored;
          return openApi.open(base, relativeTo(root, absPath), target, rest);
        },
      },
    };
  }, [client.kind, root, runOn, session, source, thisDevice]);
}
