import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import { viewerProcedure, router } from '@/lib/trpc/init';
import * as q from '@/lib/db/queries';
import { getLocalBaseUrl, getRemoteBaseUrl } from '@/lib/auth/bootstrap';
import { assertPersonalCapability } from '@/lib/home/authority';
import { homeMcpAddress } from './address';

function address() {
  assertPersonalCapability('Personal external assistants');
  try { return homeMcpAddress(getRemoteBaseUrl(), getLocalBaseUrl()); }
  catch (cause) { throw new TRPCError({ code: 'PRECONDITION_FAILED', message: cause instanceof Error ? cause.message : 'Check the Home’s remote address in Settings → Devices.', cause }); }
}

export const externalAiRouter = router({
  list: viewerProcedure.query(() => q.listPersonalAiClients()),
  address: viewerProcedure.query(address),
  create: viewerProcedure.input(z.object({ name: z.string().trim().min(1).max(q.AI_CLIENT_NAME_MAX) }).strict()).mutation(({ input }) => {
    // Validate before issuing a key, so a bad address leaves no hidden credential.
    const connection = address();
    const { client, token } = q.createPersonalAiClient(input.name);
    return { client, token: token.plaintext, ...connection };
  }),
  revoke: viewerProcedure.input(z.object({ keyId: z.string().min(1) }).strict()).mutation(({ input }) => {
    q.revokePersonalAiClient(input.keyId);
    return { ok: true as const };
  }),
});
