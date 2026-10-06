import path from 'node:path';
import { getAppRoot, getDevAppRoot } from '@/lib/config/paths';
import { reply, type OperationContext } from '@/lib/server/operation';
import os from 'node:os';
import { z as rpcZ } from 'zod/v4';

/**
 * Returns identity info about the machine running the app. Used by the
 * settings page to render "Currently connected to: <hostname>", and by the
 * marker every page of a development server shows.
 *
 * Not sensitive — same surface the user would see in `ri doctor`.
 */

/**
 * Whether this server is a development one: the dev home (`pnpm dev`,
 * `ri start --dev`, `pnpm desktop:dev`) or any server running in development
 * mode. Everything else is production, whatever folder its home is in: the
 * desktop app keeps its own (`~/Library/Application Support/Ri/home`), and a
 * team space has another. Read per request, never at build time.
 */
export type HomeEnvironment = 'production' | 'development';

export interface HostInfoResponse {
  hostname: string;
  platform: NodeJS.Platform;
  appRoot: string;
  environment: HomeEnvironment;
  /** The home folder's name, e.g. `ri-dev`. */
  homeLabel: string;
}

export function homeEnvironment(appRoot = getAppRoot(), mode = process.env.NODE_ENV): HomeEnvironment {
  if (mode === 'development') return 'development';
  return path.resolve(appRoot) === path.resolve(getDevAppRoot()) ? 'development' : 'production';
}

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const appRoot = getAppRoot();
  const body: HostInfoResponse = {
    hostname: os.hostname(),
    platform: process.platform,
    appRoot,
    environment: homeEnvironment(appRoot),
    homeLabel: path.basename(path.resolve(appRoot)),
  };
  return reply(body);
}

export const GETInput = rpcZ.object({}).strict().default({});
