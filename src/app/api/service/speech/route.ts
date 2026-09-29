import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { readLimitedJson } from '@/lib/api/limited-body';
import { managedSpeech } from '@/lib/stt/managed/manager';
const command = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['install', 'cancel', 'uninstall']) }).strict(),
  z.object({ action: z.literal('configure'), enabled: z.boolean().optional(), cloudFallback: z.boolean().optional() }).strict(),
]);
export function GET(request: NextRequest) {
  if (!isInstallationOwner(request)) return NextResponse.json({ error: 'Installation owner access required' }, { status: 403 });
  return NextResponse.json(managedSpeech().status(), { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: NextRequest) {
  if (!isInstallationOwner(request)) return NextResponse.json({ error: 'Installation owner access required' }, { status: 403 });
  try {
    const value = command.parse(await readLimitedJson(request, 4096));
    const manager = managedSpeech();
    if (value.action === 'install') return NextResponse.json(manager.install());
    if (value.action === 'cancel') return NextResponse.json(await manager.cancel());
    if (value.action === 'uninstall') return NextResponse.json(await manager.uninstall());
    if (value.action === 'configure') {
      const preferences = { ...(value.enabled === undefined ? {} : { enabled: value.enabled }), ...(value.cloudFallback === undefined ? {} : { cloudFallback: value.cloudFallback }) };
      return NextResponse.json(manager.configure(preferences));
    }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Local speech could not be changed' }, { status: 400 }); }
}
