import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serviceRequest } from '@/lib/service/client';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { readLimitedJson } from '@/lib/api/limited-body';
const input = z.object({ action: z.enum(['check', 'download', 'apply', 'when-idle', 'later']), window: z.object({ hour: z.number().int().min(0).max(23), durationHours: z.number().int().min(1).max(12), timeZone: z.string().max(100) }).optional() }).strict();
export async function POST(request: NextRequest) {
  if (!isInstallationOwner(request)) return NextResponse.json({ error: 'Manage updates from the installation owner’s desktop or local CLI.' }, { status: 403 });
  try {
    const body = input.parse(await readLimitedJson(request, 4096));
    return NextResponse.json(await serviceRequest('/update', 'POST', 3000, body));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Update action failed' }, { status: 400 }); }
}
