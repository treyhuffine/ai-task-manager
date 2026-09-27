import { NextRequest, NextResponse } from 'next/server';
import { readLimitedJson } from '@/lib/api/limited-body';
import { serviceRequest } from '@/lib/service/client';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { AwakePreferencesSchema } from '@/lib/service/awake-settings';

const denied = () => NextResponse.json({ error: 'Only the installation owner can manage host availability.' }, { status: 403 });
export async function GET(request: NextRequest) {
  if (!isInstallationOwner(request)) return denied();
  try { return NextResponse.json(await serviceRequest('/awake'), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Host availability controls require a running managed service.' }, { status: 503 }); }
}
export async function PATCH(request: NextRequest) {
  if (!isInstallationOwner(request)) return denied();
  try {
    const policy = AwakePreferencesSchema.parse(await readLimitedJson(request, 1024));
    return NextResponse.json(await serviceRequest('/awake', 'PATCH', 10_000, policy), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Host availability could not be saved.' }, { status: 400 });
  }
}
