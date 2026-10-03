import { legacySchema } from '@/lib/server/inputs';
import { boundedInput, reply, type OperationContext } from '@/lib/server/operation';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { managedSpeech } from '@/lib/stt/managed/manager';
import { z } from 'zod';
import { z as rpcZ } from 'zod/v4';
const command = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['install', 'cancel', 'uninstall']) }).strict(),
  z.object({ action: z.literal('configure'), enabled: z.boolean().optional(), cloudFallback: z.boolean().optional() }).strict(),
]);
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  if (!isInstallationOwner(request)) return reply({ error: 'Installation owner access required' }, { status: 403 });
  return reply(managedSpeech().status(), { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  if (!isInstallationOwner(request)) return reply({ error: 'Installation owner access required' }, { status: 403 });
  try {
    const value = command.parse(boundedInput(rpcInput.body, 4096));
    const manager = managedSpeech();
    if (value.action === 'install') return reply(manager.install());
    if (value.action === 'cancel') return reply(await manager.cancel());
    if (value.action === 'uninstall') return reply(await manager.uninstall());
    if (value.action === 'configure') {
      const preferences = { ...(value.enabled === undefined ? {} : { enabled: value.enabled }), ...(value.cloudFallback === undefined ? {} : { cloudFallback: value.cloudFallback }) };
      return reply(manager.configure(preferences));
    }
    return reply({ error: 'Unknown local speech action' }, { status: 400 });
  } catch (error) { return reply({ error: error instanceof Error ? error.message : 'Local speech could not be changed' }, { status: 400 }); }
}

export const GETInput = rpcZ.object({}).strict().default({});
export const POSTInput = rpcZ.object({ body: legacySchema(command) }).strict();
