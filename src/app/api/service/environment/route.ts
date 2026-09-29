import { NextRequest, NextResponse } from 'next/server';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { environmentStatus, saveEnvironment } from '@/lib/service/environment';
import { readLimitedJson } from '@/lib/api/limited-body';
export function GET(request: NextRequest) {
  if (!isInstallationOwner(request)) return NextResponse.json({ error: 'Installation owner access required' }, { status: 403 });
  return NextResponse.json(environmentStatus());
}
export async function PATCH(request: NextRequest) {
  if (!isInstallationOwner(request)) return NextResponse.json({ error: 'Installation owner access required' }, { status: 403 });
  try { return NextResponse.json({ ...saveEnvironment(await readLimitedJson(request, 32 * 1024)), restartRequired: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Configuration could not be saved' }, { status: 400 }); }
}
