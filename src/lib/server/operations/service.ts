import { reply, type OperationContext } from '@/lib/server/operation';
import { serviceStatus } from '@/lib/service/client';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { z as rpcZ } from 'zod/v4';

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  const status = await serviceStatus();
  const canManage = isInstallationOwner(request);
  // The local recovery window can show redacted Next.js startup diagnostics.
  // Paired devices get service state without local error excerpts, including
  // errors retained by the updater after a committed release fails to boot.
  const genericError = 'Service needs attention. Check this device’s local recovery window.';
  const visible = !canManage && status ? {
    ...status,
    ...(status.error ? { error: genericError } : {}),
    ...(status.update?.error ? { update: { ...status.update, error: genericError } } : {}),
  } : status;
  return reply({ ...(visible ?? { phase: 'unmanaged', update: undefined, version: undefined }), canManage }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GETInput = rpcZ.object({}).strict().default({});
