import { APP_SHORT_ID } from '@/constants/app';
import { setRemoteBaseUrl } from '@/lib/auth/bootstrap';
import { beamdCheck, beamdOpen } from '@/lib/preview/beamd/cli';
import { previewName } from '@/lib/preview/preview-name';

export interface BeamdBaseUrlResult {
  url: string;
  name: string;
  port: number;
}

export function appBeamdTunnelName(env = process.env.NODE_ENV): string {
  return previewName(env === 'development' ? `${APP_SHORT_ID}-dev` : APP_SHORT_ID);
}

export async function openAndSaveBeamdBaseUrl(port: number): Promise<BeamdBaseUrlResult> {
  const name = appBeamdTunnelName();
  await beamdCheck();
  const opened = await beamdOpen(port, name);
  const url = setRemoteBaseUrl(opened.url);
  return { url, name, port };
}
