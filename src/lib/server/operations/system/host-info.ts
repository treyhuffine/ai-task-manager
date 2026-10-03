import { getAppRoot } from '@/lib/config/paths';
import { reply, type OperationContext } from '@/lib/server/operation';
import os from 'node:os';
import { z as rpcZ } from 'zod/v4';

/**
 * Returns identity info about the machine running the app. Used by the
 * settings page to render "Currently connected to: <hostname>".
 *
 * Not sensitive — same surface the user would see in `ri doctor`.
 */

export interface HostInfoResponse {
  hostname: string;
  platform: NodeJS.Platform;
  appRoot: string;
}

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const body: HostInfoResponse = {
    hostname: os.hostname(),
    platform: process.platform,
    appRoot: getAppRoot(),
  };
  return reply(body);
}

export const GETInput = rpcZ.object({}).strict().default({});
