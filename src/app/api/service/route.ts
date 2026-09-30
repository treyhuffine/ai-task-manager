import { NextRequest, NextResponse } from 'next/server';
import { serviceStatus, type ServiceStatus } from '@/lib/service/client';
import { isInstallationOwner } from '@/lib/service/owner-auth';

export async function GET(request: NextRequest) {
  const status = await serviceStatus() as (ServiceStatus & { update?: { error?: string } }) | null;
  const canManage = isInstallationOwner(request);
  // The local recovery window can show redacted Next.js startup diagnostics.
  // Paired devices get service state without local error excerpts, including
  // errors retained by the updater after a committed release fails to boot.
  const genericError = 'Service needs attention. Check this device’s local recovery window.';
  const visible = !canManage && status ? { ...status,
    ...(status.error ? { error: genericError } : {}),
    ...(status.update?.error ? { update: { ...status.update, error: genericError } } : {}),
  } : status;
  return NextResponse.json({ ...(visible ?? { phase: 'unmanaged' }), canManage }, { headers: { 'Cache-Control': 'no-store' } });
}
