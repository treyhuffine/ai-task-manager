import { NextRequest, NextResponse } from 'next/server';
import { readLimitedJson } from '@/lib/api/limited-body';
import { serviceRequest } from '@/lib/service/client';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { UpdatePreferencesSchema } from '@/lib/service/update-settings';

export async function PATCH(request: NextRequest) {
  if (!isInstallationOwner(request)) return NextResponse.json({ error: 'Manage updates from the installation owner’s desktop or local CLI.' }, { status: 403 });
  try {
    const preferences = UpdatePreferencesSchema.parse(await readLimitedJson(request, 4096));
    return NextResponse.json(await serviceRequest('/update/policy', 'PATCH', 3000, preferences), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Update preferences could not be saved' }, { status: 400 });
  }
}
