import os from 'node:os';
import { getAppRoot } from '@/lib/config/paths';

/**
 * Returns identity info about the machine running the app. Used by the
 * settings page to render "Currently connected to: <hostname>" and by
 * the takeover modal to label the host in copy-paste commands.
 *
 * Not sensitive — same surface the user would see in `flow doctor`.
 */

export interface HostInfoResponse {
  hostname: string;
  platform: NodeJS.Platform;
  appRoot: string;
}

export function GET() {
  const body: HostInfoResponse = {
    hostname: os.hostname(),
    platform: process.platform,
    appRoot: getAppRoot(),
  };
  return Response.json(body);
}
