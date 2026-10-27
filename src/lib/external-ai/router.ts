import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import { viewerProcedure, router } from '@/lib/trpc/init';
import * as q from '@/lib/db/queries';
import { getLocalBaseUrl, getRemoteBaseUrl } from '@/lib/auth/bootstrap';
import { assertPersonalCapability } from '@/lib/home/authority';
import { homeEnvironment } from '@/lib/server/operations/system/host-info';
import { defaultDeviceName } from '@/lib/home/device-name';
import { homeMcpAddress } from './address';
import { connectLocalAgent, disconnectLocalAgent, listLocalAgents, LocalSetupError } from './local-setup';
import { aiClient, personalMcpNames } from './client-config';
import { aiClientKeyInput, clientKind } from './key-input';


function address() {
  assertPersonalCapability('Personal external assistants');
  try { return { ...homeMcpAddress(getRemoteBaseUrl(), getLocalBaseUrl()), ...personalMcpNames(homeEnvironment()) }; }
  catch (cause) { throw new TRPCError({ code: 'PRECONDITION_FAILED', message: cause instanceof Error ? cause.message : 'Check your Ri’s remote address in Settings → Devices.', cause }); }
}

/** A setup problem keeps its message, which says what to do. */
async function local<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (cause) {
    if (cause instanceof LocalSetupError) throw new TRPCError({ code: cause.code === 'failed' ? 'INTERNAL_SERVER_ERROR' : 'PRECONDITION_FAILED', message: cause.message, cause });
    throw cause;
  }
}

export const externalAiRouter = router({
  list: viewerProcedure.query(() => q.listPersonalAiClients()),
  address: viewerProcedure.query(address),
  /** A key for one agent, made where its steps, link or setup prompt need it. Shown once. */
  create: viewerProcedure.input(aiClientKeyInput).mutation(({ input }) => {
    // Validate before issuing a key, so a bad address leaves no hidden credential.
    const connection = address();
    const agent = aiClient(input.client);
    if (agent.limitation) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: agent.limitation });
    const { client, token } = q.createPersonalAiClient(input.name ?? agent.keyName, input.client);
    return { client, token: token.plaintext, ...connection };
  }),
  revoke: viewerProcedure.input(z.object({ keyId: z.string().min(1) }).strict()).mutation(({ input }) => {
    q.revokePersonalAiClient(input.keyId);
    return { ok: true as const };
  }),
  /** The agents Ri can set up on the computer running it, as their own configuration says now. */
  local: viewerProcedure.query(() => local(async () => ({ device: defaultDeviceName(), agents: await listLocalAgents() }))),
  setUp: viewerProcedure.input(z.object({ client: clientKind }).strict()).mutation(({ input }) => local(() => connectLocalAgent(input.client))),
  disconnectLocal: viewerProcedure.input(z.object({ client: clientKind }).strict()).mutation(({ input }) => local(() => disconnectLocalAgent(input.client))),
});
