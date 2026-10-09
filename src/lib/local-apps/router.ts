import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { publicError, slugSchema } from "@ri/app-kit/contract";
import { viewerProcedure as p, router } from "@/lib/trpc/init";
import { OperationError } from "@/lib/server/operation";
import { localApps, localAppsEnabled } from "./service";
import { grantSchema, scheduleSchema } from "./state";
import * as q from "@/lib/db/queries";
const id = z.uuid(),
  revision = z.number().int().nonnegative();
const location = {
  path: z
    .string()
    .regex(/^\/(?!\/)/)
    .max(1024)
    .default("/"),
  query: z.record(z.string().max(128), z.string().max(1024)).default({}),
};
export async function appOperation<T>(
  operation: () => Promise<T> | T,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error('[local-apps] Operation failed:', error instanceof Error ? error.message.slice(0, 1500) : 'Unknown operation error');
    const failure = publicError(error);
    const code =
      failure.code === "not_found"
        ? "NOT_FOUND"
        : ["forbidden", "revoked"].includes(failure.code)
          ? "FORBIDDEN"
          : failure.code === "invalid_input"
            ? "BAD_REQUEST"
            : "CONFLICT";
    throw new TRPCError({
      code,
      message: failure.message,
      cause: new OperationError(
        code === "NOT_FOUND"
          ? 404
          : code === "FORBIDDEN"
            ? 403
            : code === "BAD_REQUEST"
              ? 400
              : 409,
        { ...failure, error: failure.message },
      ),
    });
  }
}
function requireChat(chatId: string) {
  const chat = q.getChatSession(chatId);
  if (!chat || chat.status === "archived")
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This chat is no longer available",
    });
  return chat;
}
export const localAppsRouter = router({
  enabled: p.query(() => ({ enabled: localAppsEnabled() })),
  list: p.query(() => appOperation(() => localApps().list())),
  toolSummary: p.input(z.object({ id, draft: z.boolean().optional() }).strict()).query(({input}) => appOperation(async () => {
    const artifact = await localApps().artifact(input.id, input.draft);
    return { name: artifact.manifest.extensions['com.ri'].displayName, actions: artifact.contract.actions.map(({ name, description, examples }) => ({ name, description, examples })) };
  })),
  catalog:p.query(()=>appOperation(()=>localApps().catalog())),
  addCatalog:p.input(z.object({packageId:z.string().max(64)}).strict()).mutation(({input})=>appOperation(()=>localApps().addCatalog(input.packageId))),
  updateCatalog:p.input(z.object({id,revision}).strict()).mutation(({input})=>appOperation(()=>localApps().updateCatalog(input.id,input.revision))),
  describe: p
    .input(z.object({ id }).strict())
    .query(({ input }) => appOperation(() => localApps().describe(input.id))),
  serviceStatus: p.input(z.object({id}).strict()).query(({input}) => appOperation(() => localApps().serviceStatus(input.id))),
  access: p.input(z.object({id,chatId:id}).strict()).query(({input})=>appOperation(()=>{
    requireChat(input.chatId);
    const apps=localApps();apps.instance(input.id);
    try { const grant=apps.grant(input.id,{kind:'chat',id:input.chatId});return {id:grant.id,revision:grant.revision,actions:grant.actions}; }
    catch(error) { if((error as {code?:string}).code==='forbidden'||(error as {code?:string}).code==='revoked')return null;throw error; }
  })),
  configure: p
    .input(
      z
        .object({
          id,
          revision,
          patch: z
            .object({
              slug: slugSchema.optional(),
              enabled: z.boolean().optional(),
              archived: z.boolean().optional(),
            })
            .strict(),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      appOperation(() =>
        localApps().configure(input.id, input.patch, input.revision),
      ),
    ),
  remove: p
    .input(z.object({ id, revision }).strict())
    .mutation(({ input }) =>
      appOperation(() => localApps().remove(input.id, input.revision)),
    ),
  retry: p.input(z.object({ id }).strict()).mutation(({ input }) =>
    appOperation(() => {
      localApps().instance(input.id);
      localApps().engine.retry(input.id);
    }),
  ),
  repair: p
    .input(
      z
        .object({ id, revision, choice: z.enum(["current", "previous"]) })
        .strict(),
    )
    .mutation(({ input }) =>
      appOperation(() =>
        localApps().repair(input.id, input.choice, input.revision),
      ),
    ),
  grant: p
    .input(
      z
        .object({
          revision,
          grant: grantSchema.omit({
            id: true,
            createdAt: true,
            updatedAt: true,
            revision: true,
            revokedAt: true,
          }),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      appOperation(() => localApps().saveGrant(input.grant, input.revision)),
    ),
  revoke: p
    .input(z.object({ id, revision }).strict())
    .mutation(({ input }) =>
      appOperation(() => localApps().revokeGrant(input.id, input.revision)),
    ),
  schedule: p
    .input(
      z
        .object({
          revision,
          schedule: scheduleSchema.omit({
            id: true,
            createdAt: true,
            updatedAt: true,
            nextRunAt: true,
            runningInvocationId: true,
          }),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      appOperation(() => localApps().schedule(input.schedule, input.revision)),
    ),
  createDraft: p
    .input(
      z
        .object({
          profile: z.enum(["react", "html", "static"]).default("react"),
          sourceInstanceId: id.optional(),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      appOperation(() =>
        localApps().createDraft(input.profile, input.sourceInstanceId),
      ),
    ),
  build: p
    .input(z.object({ id }).strict())
    .mutation(({ input }) => appOperation(() => localApps().build(input.id))),
  cancelBuild: p
    .input(z.object({ id }).strict())
    .mutation(({ input }) =>
      appOperation(() => localApps().cancelBuild(input.id)),
    ),
  activate: p
    .input(z.object({ id, revision }).strict())
    .mutation(({ input }) =>
      appOperation(() => localApps().activate(input.id, input.revision)),
    ),
  export: p
    .input(z.object({ id }).strict())
    .mutation(({ input }) => appOperation(() => localApps().export(input.id))),
  log:p.input(z.object({id,draft:z.boolean().optional()}).strict()).query(({input})=>appOperation(()=>localApps().readLog(input.id,input.draft))),
  invoke: p
    .input(
      z
        .object({
          id,
          action: z.string().max(64),
          input: z.unknown(),
          invocationId: id,
        })
        .strict(),
    )
    .mutation(({ input, ctx }) =>
      appOperation(() =>
        localApps().call(
          input.id,
          input.action,
          input.input,
          undefined,
          input.invocationId,
          ctx.request?.signal,
        ),
      ),
    ),
  openView: p
    .input(
      z
        .object({
          id,
          draft: z.boolean().optional(),
          chatId: z.string().optional(),
          ...location,
        })
        .strict(),
    )
    .mutation(({ input, ctx }) =>
      appOperation(() => {
        if (input.chatId) requireChat(input.chatId);
        return localApps().openView(input, ctx.key!.apiKeyId);
      }),
    ),
  viewCall: p
    .input(
      z
        .object({
          viewId: id,
          action: z.string().max(64),
          input: z.unknown(),
          invocationId: id,
        })
        .strict(),
    )
    .mutation(({ input, ctx }) =>
      appOperation(() =>
        localApps().viewCall(
          input.viewId,
          ctx.key!.apiKeyId,
          input.action,
          input.input,
          input.invocationId,
        ),
      ),
    ),
  fileAccess: p.input(z.object({viewId:id,mode:z.enum(['select','download'])}).strict()).mutation(({input,ctx})=>appOperation(()=>localApps().fileAccess(input.viewId,ctx.key!.apiKeyId,input.mode))),
  context: p
    .input(z.object({ viewId: id, state: z.unknown() }).strict())
    .mutation(({ input, ctx }) =>
      appOperation(() =>
        localApps().updateContext(input.viewId, ctx.key!.apiKeyId, input.state),
      ),
    ),
  closeView: p
    .input(z.object({ viewId: id }).strict())
    .mutation(({ input, ctx }) =>
      appOperation(() =>
        localApps().closeView(input.viewId, ctx.key!.apiKeyId),
      ),
    ),
  refreshView: p
    .input(z.object({ viewId: id }).strict())
    .mutation(({ input, ctx }) =>
      appOperation(() =>
        localApps().refreshView(input.viewId, ctx.key!.apiKeyId),
      ),
    ),
  panel: p
    .input(
      z
        .object({ chatId: z.string(), instanceId: id.nullable(), ...location })
        .strict(),
    )
    .mutation(({ input }) =>
      appOperation(() => {
        requireChat(input.chatId);
        return localApps().setPanel(input.chatId, input.instanceId, {
          path: input.path,
          query: input.query,
        });
      }),
    ),
  acceptOpen: p
    .input(z.object({ chatId: z.string(), reference: id }).strict())
    .mutation(({ input }) =>
      appOperation(() => {
        requireChat(input.chatId);
        return localApps().acceptOpen(input.chatId, input.reference);
      }),
    ),
  approval: p
    .input(z.object({ id, approve: z.boolean() }).strict())
    .mutation(({ input }) =>
      appOperation(() => localApps().decideApproval(input.id, input.approve)),
    ),
});
