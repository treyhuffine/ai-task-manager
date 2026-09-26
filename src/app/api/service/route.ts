import { NextRequest, NextResponse } from 'next/server';
import { serviceStatus } from '@/lib/service/client';
import { isInstallationOwner } from '@/lib/service/owner-auth';

export async function GET(request: NextRequest) {
  const status = await serviceStatus();
  return NextResponse.json({ ...(status ?? { phase: 'unmanaged' }), canManage: isInstallationOwner(request) }, { headers: { 'Cache-Control': 'no-store' } });
}
