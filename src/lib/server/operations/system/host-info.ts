import path from 'node:path';
import { getAppRoot, getDevAppRoot, getProductionAppRoot } from '@/lib/config/paths';
import { reply, type OperationContext } from '@/lib/server/operation';
import os from 'node:os';
import { z as rpcZ } from 'zod/v4';

/**
 * Returns identity info about the machine running the app. Used by the
 * settings page to render "Currently connected to: <hostname>", and by the
 * marker every page shows when this isn't the production home.
 *
 * Not sensitive — same surface the user would see in `ri doctor`.
 */

/**
 * Which home this server runs: the production home, the dev home
 * (`pnpm dev`, `ri start --dev`, `pnpm desktop:dev`), or another isolated
 * one (`pnpm iso`, a test home). Read per request, never at build time, so a
 * release build can't bake in where it was built.
 */
export type HomeEnvironment = 'production' | 'development' | 'isolated';

export interface HostInfoResponse {
  hostname: string;
  platform: NodeJS.Platform;
  appRoot: string;
  environment: HomeEnvironment;
  /** The home folder's name, e.g. `ri-dev`. */
  homeLabel: string;
}

export function homeEnvironment(appRoot = getAppRoot()): HomeEnvironment {
  const root = path.resolve(appRoot);
  if (root === path.resolve(getProductionAppRoot())) return 'production';
  if (root === path.resolve(getDevAppRoot())) return 'development';
  return 'isolated';
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
