import { z } from "zod/v4";
import { AppError } from "@ri/app-kit/contract";
import { localApps } from "./service";
import type { AppGrant } from "./state";
const operations = [
  "plaid.link.begin",
  "plaid.link.complete",
  "plaid.transactions.sync",
  "plaid.accounts.read",
  "plaid.liabilities.read",
  "plaid.item.remove",
  "plaid.webhook.key",
  "gmail.messages.read",
  "outlook.messages.read",
  "connection.release",
] as const;
export const brokerCallSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().min(1).max(160),
    connectionId: z.string().min(1).max(128),
    operation: z.enum(operations),
    input: z.record(z.string(), z.unknown()),
  })
  .strict();
function authority(
  credential: string,
  ticket: string | null,
): {
  instanceId: string;
  grant: AppGrant;
  context: import("@ri/app-kit/contract").InvocationContext | null;
} {
  const apps = localApps(),
    process = apps.brokerCredentials.get(credential);
  if (
    !process ||
    apps.generations.get(process.instanceId) !== process.generation
  )
    throw new AppError("revoked", "This app process credential expired");
  const instance = apps.instance(process.instanceId);
  if (ticket) {
    const bound = apps.brokerTickets.get(ticket),
      active = apps.engine.condition(instance.id).invocationId;
    if (
      !bound ||
      bound.instanceId !== instance.id ||
      bound.generation !== process.generation ||
      bound.expiresAt < Date.now() ||
      bound.context.id !== active
    )
      throw new AppError("revoked", "This invocation ticket expired");
    const grant = apps.grant(instance.id, bound.context.principal);
    if (
      !grant ||
      grant.revision !== bound.context.grantRevision ||
      instance.digest !== bound.context.packageDigest
    )
      throw new AppError("revoked", "This caller grant changed");
    return { instanceId: instance.id, grant, context: bound.context };
  }
  const grant = apps.store
    .read()
    .grants.find(
      (item) =>
        item.instanceId === instance.id &&
        item.principal.kind === "background" &&
        !item.revokedAt,
    );
  if (!grant)
    throw new AppError(
      "forbidden",
      "This app has no background connector grant",
    );
  return { instanceId: instance.id, grant, context: null };
}
const wireActions: Record<(typeof operations)[number], string[]> = {
  "gmail.messages.read": [
    "gmail.get_profile",
    "gmail.search_messages",
    "gmail.read_message",
    "gmail.get_attachment",
    "gmail.list_history",
  ],
  "outlook.messages.read": ["outlook.search_messages", "outlook.get_message"],
  "plaid.link.begin": ["plaid.create_link_token"],
  "plaid.link.complete": ["plaid.exchange_public_token"],
  "plaid.transactions.sync": ["plaid.sync_transactions"],
  "plaid.accounts.read": ["plaid.get_accounts"],
  "plaid.liabilities.read": ["plaid.get_liabilities"],
  "plaid.item.remove": ["plaid.remove_item"],
  "plaid.webhook.key": ["plaid.get_webhook_key"],
  "connection.release": [],
};
export async function brokerCapabilities(
  credential: string,
  ticket: string | null,
) {
  const { grant } = authority(credential, ticket);
  const { getIntegrationRuntime, getIntegrationOwnerId } = await import(
    "@/lib/integrations/runtime"
  );
  const connections = await (
    await getIntegrationRuntime()
  ).listConnections({ ownerId: getIntegrationOwnerId() });
  return {
    version: 1,
    principal: { kind: "plugin", id: grant.instanceId },
    operations: operations.filter(
      (operation) =>
        operation === "gmail.messages.read" &&
        grant.connections.some((binding) =>
          wireActions[operation].every((action) =>
            binding.actions.includes(action),
          ),
        ),
    ),
    connections: grant.connections.flatMap((binding) => {
      const connection = connections.find(
        (item) => item.id === binding.connectionId,
      );
      return connection &&
        ["google", "plaid", "microsoft"].includes(connection.providerId)
        ? [
            {
              id: connection.id,
              provider: connection.providerId,
              status: connection.status === "active" ? "active" : "reconnect",
              scopes: connection.scopes ?? [],
              label:
                connection.label ?? connection.email ?? connection.providerId,
            },
          ]
        : [];
    }),
  };
}
export async function brokerCall(
  credential: string,
  ticket: string | null,
  raw: unknown,
) {
  const input = brokerCallSchema.parse(raw),
    auth = authority(credential, ticket);
  const binding = auth.grant.connections.find(
    (item) => item.connectionId === input.connectionId,
  );
  if (!binding)
    throw new AppError("forbidden", "This connection is outside the app grant");
  if (input.operation !== "gmail.messages.read")
    throw new AppError(
      "unsupported",
      "This compatibility operation has not been qualified. Manual records and CSV import remain available",
    );
  const request = (await import("./gmail")).gmailBrokerRequest(input.input),
    name = request.name;
  if (!name || !binding.actions.includes(name))
    throw new AppError(
      "unsupported",
      "This broker operation is not implemented or granted",
    );
  // Shared dispatcher owns approval continuation and live caller checks.
  const apps = localApps(),
    artifact = await apps.artifact(auth.instanceId);
  const call = {
    callId: input.requestId,
    name,
    binding: binding.binding,
    input: request.input,
  };
  const result = auth.context
    ? await apps.dispatchCapability(
        {
          ...artifact,
          instanceId: auth.instanceId,
          dataDir: "",
          cacheDir: "",
          logsDir: "",
        },
        auth.context,
        call,
        apps.engine.invocationSignal(auth.instanceId, auth.context.id),
      )
    : await apps.backgroundCapability(auth.instanceId, auth.grant, call);
  authority(credential, ticket);
  return { version: 1, ok: true as const, result };
}
