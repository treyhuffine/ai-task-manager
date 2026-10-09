import { z } from "zod";
import {
  defineAction,
  ActionError,
  type ActionContext,
} from "@/lib/orchestrator/types";
import {
  SESSION_CREDENTIAL_ENV,
  SESSION_CREDENTIAL_HEADER,
} from "@/lib/orchestrator/session-credential";
import { serverFetch } from "@/lib/orchestrator/server-client";
import { publicError } from "@ri/app-kit/contract";
import { localApps } from "./service";
import { getChatSession } from "@/lib/db/queries";

/** Local CLI goes through the running Home, never a second file writer. */
export async function dispatchAppAction(
  ctx: ActionContext,
  operation: string,
  input: Record<string, unknown>,
) {
  if (ctx.remote === false)
    return serverFetch<unknown>("/local-apps/action", {
      method: "POST",
      body: JSON.stringify({ operation, input }),
      headers: {
        [SESSION_CREDENTIAL_HEADER]: process.env[SESSION_CREDENTIAL_ENV] ?? "",
      },
    });
  const apps = localApps(),
    chatId = ctx.actor?.sessionId;
  try {
    const chat = chatId ? getChatSession(chatId) : null;
    const fixtureDraft = chat?.surfaceKind === 'app-try' ? chat.surfaceRef : null;
    const builderDraft = chat?.surfaceKind === 'app-builder' ? chat.surfaceRef : null;
    if (fixtureDraft && ['create','build','create_workflow'].includes(operation)) throw new ActionError('unsupported','A try chat can only use its own fixture app');
    if (builderDraft && ['build','create_workflow'].includes(operation) && input.draft_id !== builderDraft) throw new ActionError('unsupported','This builder can only change its own draft');
    if (builderDraft && operation === 'create') throw new ActionError('unsupported','Continue in this builder draft');
    if (fixtureDraft && ['describe','call','workflow'].includes(operation) && input.instance_id !== fixtureDraft) throw new ActionError('unsupported','This try chat can only use its own fixture app');
    if (operation === 'list') {
      if (fixtureDraft) {const artifact = await apps.artifact(fixtureDraft,true); return {instances:[{id:fixtureDraft,packageId:artifact.manifest.name,version:artifact.manifest.version,fixture:true}]};}
      const list = apps.list();
      return {revision:list.revision, instances:list.instances.filter(instance => {
        if (!instance.enabled || instance.archived || builderDraft) return false;
        if (!chatId) return true;
        try {return apps.grant(instance.id,{kind:'chat',id:chatId}).actions.length > 0;} catch {return false;}
      })};
    }
    if (operation === 'describe') {
      if (fixtureDraft) {const artifact = await apps.artifact(fixtureDraft,true);return {draft:apps.draft(fixtureDraft),manifest:artifact.manifest,contract:artifact.contract,fixture:true};}
      const id = String(input.instance_id);
      const description = await apps.describe(id);
      if (!chatId) return description;
      apps.instance(id);
      const grant = apps.grant(id,{kind:'chat',id:chatId});
      return {...description, contract:{...description.contract, actions:description.contract.actions.filter(action => grant.actions.includes(action.name) && action.audience.includes('agent') && action.visibility !== 'app'), workflows:grant.actions.length ? description.contract.workflows : []}};
    }
    if (operation === "call") {
      if (chatId) {
        const { getChatSession } = await import("@/lib/db/queries");
        const chat = getChatSession(chatId);
        if (
          chat?.surfaceKind === "app-try" &&
          chat.surfaceRef &&
          chat.surfaceRef === input.instance_id
        ) {
          const artifact = await apps.artifact(chat.surfaceRef, true);
          return apps.engine.invoke(
            {
              ...artifact,
              instanceId: chat.surfaceRef,
              dataDir: apps
                .draftDir(chat.surfaceRef)
                .replace(/\/package$/, "/data"),
              cacheDir: apps
                .draftDir(chat.surfaceRef)
                .replace(/\/package$/, "/cache"),
              logsDir: apps
                .draftDir(chat.surfaceRef)
                .replace(/\/package$/, "/logs"),
            },
            String(input.action),
            input.input,
            { kind: "fixture", id: chat.surfaceRef },
            0,
            input.invocation_id as string | undefined,
          );
        }
      }
      return apps.call(
        String(input.instance_id),
        String(input.action),
        input.input,
        chatId ? { kind: "chat", id: chatId } : undefined,
        input.invocation_id as string | undefined,
      );
    }
    if (operation === "open") {
      if (!chatId)
        throw new ActionError(
          "invalid_params",
          "Open app from an existing chat",
        );
      return apps.proposeOpen(
        String(input.instance_id),
        chatId,
        String(input.path ?? "/"),
        (input.query ?? {}) as Record<string, string>,
      );
    }
    if (operation === "create")
      return apps.createDraft(
        input.profile as "react" | "html" | "static",
        input.source_instance_id as string | undefined,
      );
    if (operation === "build") return apps.build(String(input.draft_id));
    if (operation === "workflow") {
      const instanceId = String(input.instance_id);
      const description = await dispatchAppAction(ctx, "describe", {
        instance_id: instanceId,
      });
      if (!description) throw new ActionError("not_found", "App not found");
      if (chatId && !fixtureDraft && !(description as {contract:{workflows:{name:string}[]}}).contract.workflows.some(item=>item.name===input.name)) throw new ActionError('unsupported','This workflow is outside the chat’s current app access');
      const artifact = await apps.artifact(instanceId, !!fixtureDraft);
      return (await import("@/lib/skills/manage")).readAppWorkflow(
        artifact.packageDir,
        artifact.contract.workflows,
        String(input.name),
        input.resource as string|undefined,
      );
    }
    if (operation === "create_workflow") {
      const draftId = String(input.draft_id);
      apps.draft(draftId);
      const manager = await import('@/lib/skills/manage');
      const draft = apps.draft(draftId);
      const existing = draft.skillDraftRefs.find(ref => ref === `draft:${input.name}`);
      const skill = existing ? (await manager.saveSkill(existing,{description:String(input.description),body:String(input.body)})).skill : await manager.newSkill({name:String(input.name),description:String(input.description),body:String(input.body)});
      await apps.store.edit(undefined, (state) => {
        const refs = state.drafts.find(item => item.id === draftId)!.skillDraftRefs; if (!refs.includes(skill.ref)) refs.push(skill.ref);
      });
      return skill;
    }
    throw new ActionError("unsupported", "Unknown app operation");
  } catch (error) {
    if (error instanceof ActionError) throw error;
    const failure = publicError(error);
    throw new ActionError(
      failure.code === "not_found"
        ? "not_found"
        : failure.code === "invalid_input"
          ? "invalid_params"
          : failure.code === "unsupported"
            ? "unsupported"
            : "conflict",
      failure.message,
      undefined,
      { reason: failure.code },
    );
  }
}
export const localAppActions = [
  defineAction({
    name: "list_apps",
    description: "List enabled local apps available to this caller",
    params: {},
    handler: (ctx) => dispatchAppAction(ctx, "list", {}),
  }),
  defineAction({
    name: "describe_app",
    description:
      "Describe an authorized app and its typed action, entity and workflow contract",
    params: { instance_id: z.string().uuid() },
    handler: (ctx, input) => dispatchAppAction(ctx, "describe", input),
  }),
  defineAction({
    name: "call_app_action",
    description:
      "Call a declared app action through the live caller grant. Reuse invocation_id only for an identical retry",
    mutating: true,
    params: {
      instance_id: z.string().uuid(),
      action: z.string().max(64),
      input: z.unknown(),
      invocation_id: z.string().uuid().optional(),
    },
    handler: (ctx, input) => dispatchAppAction(ctx, "call", input),
  }),
  defineAction({
    name: "open_app",
    description:
      "Return an explicit Open control for an app in the calling chat",
    params: {
      instance_id: z.string().uuid(),
      path: z
        .string()
        .regex(/^\/(?!\/)/)
        .default("/"),
      query: z.record(z.string()).default({}),
    },
    handler: (ctx, input) => dispatchAppAction(ctx, "open", input),
  }),
  defineAction({
    name: "create_app_draft",
    description:
      "Create an editable app draft or stage a change, with independent fixture preview data",
    mutating: true,
    params: {
      profile: z.enum(["react", "html", "static"]).default("react"),
      source_instance_id: z.string().uuid().optional(),
    },
    handler: (ctx, input) => dispatchAppAction(ctx, "create", input),
  }),
  defineAction({
    name: "build_app_draft",
    description:
      "Build with the pinned kit and validate this exact draft for native preview and owner activation",
    mutating: true,
    params: { draft_id: z.string().uuid() },
    handler: (ctx, input) => dispatchAppAction(ctx, "build", input),
  }),
  defineAction({
    name: "get_app_workflow",
    description:
      "Read a bundled workflow for the currently authorized app instance. Package instructions cannot widen grants",
    params: { instance_id: z.string().uuid(), name: z.string().max(64), resource:z.string().max(1024).optional() },
    handler: (ctx, input) => dispatchAppAction(ctx, "workflow", input),
  }),
  defineAction({
    name: "create_app_workflow",
    description:
      "Author an app workflow through the skill manager draft lifecycle",
    mutating: true,
    params: {
      draft_id: z.string().uuid(),
      name: z.string().max(64),
      description: z.string().max(1024),
      body: z.string().max(64000),
    },
    handler: (ctx, input) => dispatchAppAction(ctx, "create_workflow", input),
  }),
] as const;
