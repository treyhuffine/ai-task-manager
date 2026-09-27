import { NextRequest, NextResponse } from 'next/server';
import { serviceRequest } from '@/lib/service/client';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { readLimitedJson } from '@/lib/api/limited-body';
import { UpdateActionSchema } from '@/lib/service/update-settings';
export async function POST(request: NextRequest) {
  if (!isInstallationOwner(request)) return NextResponse.json({ error: 'Manage updates from the installation owner’s desktop or local CLI.' }, { status: 403 });
  try {
    const body = UpdateActionSchema.parse(await readLimitedJson(request, 4096));
    return NextResponse.json(await serviceRequest('/update', 'POST', 3000, body));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Update action failed' }, { status: 400 }); }
}
