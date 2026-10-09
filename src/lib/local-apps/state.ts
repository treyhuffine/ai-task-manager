import fs from "node:fs";
import path from "node:path";
import { z } from "zod/v4";
import {
  AppError,
  LIMITS,
  principalSchema,
  slugSchema,
} from "@ri/app-kit/contract";
import { atomicWriteFile, withFileLock } from "@/lib/config/atomic-file";

const id = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamps = { createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };
const activationSchema = z
  .object({
    phase: z.enum(["prepared", "switching", "checking", "active", "failed"]),
    previousDigest: digest.nullable(),
    nextDigest: digest,
    snapshotId: id.nullable(),
    replacementId: id,
  })
  .strict();
export const instanceSchema = z
  .object({
    id,
    ...timestamps,
    slug: slugSchema,
    packageId: z.string().min(1).max(64),
    version: z.string().max(100),
    digest,
    enabled: z.boolean(),
    archived: z.boolean(),
    activation: activationSchema.nullable(),
    provenance: z
      .object({
        kind: z.enum(["personal", "starter", "import"]),
        packageId: z.string().max(64),
        version: z.string().max(100),
        sourceDigest: digest,
      })
      .strict(),
    customized: z.boolean(),
    changeRevision: z.number().int().nonnegative(),
  })
  .strict();
export type AppInstance = z.infer<typeof instanceSchema>;
export const draftSchema = z
  .object({
    id,
    ...timestamps,
    sourceInstanceId: id.nullable(),
    sourcePackageDigest: digest.nullable(),
    catalogSource: z.object({ packageId: z.string(), artifactDigest: digest, name: z.string() }).strict().optional(),
    builderChatId: z.string().nullable(),
    tryChatId: z.string().nullable(),
    skillDraftRefs: z.array(z.string()).max(LIMITS.skills),
    validatedDigest: digest.nullable(),
    validatedSourceDigest: digest.nullable(),
    buildStatus: z.enum(["idle", "building", "validated", "failed"]),
    buildError: z.string().max(1000).nullable(),
  })
  .strict();
export type AppDraft = z.infer<typeof draftSchema>;
export const grantSchema = z
  .object({
    id,
    ...timestamps,
    instanceId: id,
    principal: principalSchema,
    actions: z.array(z.string().min(1).max(64)).max(100),
    riActions: z.array(z.string().min(1).max(64)).max(20),
    connections: z
      .array(
        z
          .object({
            binding: z.string().min(1).max(64),
            connectionId: z.string().min(1).max(128),
            actions: z.array(z.string().max(128)).max(50),
          })
          .strict(),
      )
      .max(20),
    serviceScopeRef: z.string().min(1).max(512).nullable(),
    revision: z.number().int().positive(),
    revokedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type AppGrant = z.infer<typeof grantSchema>;
export const scheduleSchema = z
  .object({
    id,
    ...timestamps,
    instanceId: id,
    action: z.string().min(1).max(64),
    input: z.unknown(),
    cron: z.string().min(1).max(100),
    timezone: z.string().min(1).max(100),
    activeHours: z
      .object({
        start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict()
      .nullable(),
    enabled: z.boolean(),
    nextRunAt: z.iso.datetime(),
    grantId: id,
    runningInvocationId: id.nullable(),
  })
  .strict();
export type AppSchedule = z.infer<typeof scheduleSchema>;
export const panelSchema = z
  .object({
    id,
    ...timestamps,
    chatId: z.string().min(1).max(128),
    instanceId: id,
    path: z.string().regex(/^\//).max(1024),
    query: z.record(z.string().max(128), z.string().max(1024)),
    viewRef: z.string().max(128).nullable(),
  })
  .strict();
export type AppPanel = z.infer<typeof panelSchema>;
export const summarySchema = z
  .object({
    id,
    ...timestamps,
    instanceId: id,
    action: z.string().max(64),
    principal: principalSchema,
    packageDigest: digest,
    grantRevision: z.number().int().nonnegative(),
    scheduleId: id.nullable(),
    slot: z.string().max(100).nullable(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    outcome: z.string().max(100),
    error: z.string().max(1000).nullable(),
  })
  .strict();
export type InvocationSummary = z.infer<typeof summarySchema>;
export const appStateSchema = z
  .object({
    formatVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    instances: z.array(instanceSchema).max(LIMITS.instances),
    drafts: z.array(draftSchema).max(LIMITS.drafts),
    grants: z.array(grantSchema).max(10000),
    schedules: z.array(scheduleSchema).max(LIMITS.instances * LIMITS.schedules),
    panels: z.array(panelSchema).max(LIMITS.panels),
    invocations: z
      .array(summarySchema)
      .max(LIMITS.instances * (LIMITS.summaries + LIMITS.queued + 1)),
  })
  .strict()
  .superRefine((state, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    for (const records of [
      state.instances,
      state.drafts,
      state.grants,
      state.schedules,
      state.panels,
      state.invocations,
    ])
      if (new Set(records.map((record) => record.id)).size !== records.length)
        fail("Metadata contains duplicate IDs");
    if (
      new Set(state.instances.map((instance) => instance.slug)).size !==
      state.instances.length
    )
      fail("App names must remain unique, including archived apps");
    const installed = state.instances.filter((instance) => !instance.archived);
    if (
      new Set(installed.map((instance) => instance.packageId)).size !==
      installed.length
    )
      fail("Only one active instance of each package is supported");
    if (
      new Set(state.panels.map((panel) => panel.chatId)).size !==
      state.panels.length
    )
      fail("A chat can have only one app panel");
    for (const instance of state.instances)
      if (
        state.schedules.filter(
          (schedule) => schedule.instanceId === instance.id,
        ).length > LIMITS.schedules
      )
        fail("This app has too many schedules");
    const instances = new Set(state.instances.map((instance) => instance.id));
    for (const record of [
      ...state.grants,
      ...state.schedules,
      ...state.panels,
      ...state.invocations,
    ])
      if (!instances.has(record.instanceId))
        fail("Metadata contains a missing app reference");
  });
export type AppState = z.infer<typeof appStateSchema>;
export function emptyAppState(): AppState {
  return {
    formatVersion: 1,
    revision: 0,
    instances: [],
    drafts: [],
    grants: [],
    schedules: [],
    panels: [],
    invocations: [],
  };
}
export class AppStateStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly file: string) {}
  read(): AppState {
    if (!fs.existsSync(this.file)) return emptyAppState();
    try {
      if (fs.statSync(this.file).size > 16 * 1024 * 1024)
        throw new Error("Metadata too large");
      return appStateSchema.parse(
        JSON.parse(fs.readFileSync(this.file, "utf8")),
      );
    } catch {
      throw new AppError(
        "conflict",
        "Local app metadata is corrupt or uses an unsupported version. Restore a verified backup or repair state.json before continuing",
      );
    }
  }
  async initialize() {
    if (!fs.existsSync(this.file)) await this.edit(undefined, () => {});
    else this.read();
  }
  edit<T>(
    expectedRevision: number | undefined,
    operation: (state: AppState) => T,
    management = true,
  ): Promise<T> {
    const edit = this.tail.then(() =>
      withFileLock(this.file, () => {
        const state = this.read();
        if (
          expectedRevision !== undefined &&
          expectedRevision !== state.revision
        )
          throw new AppError(
            "conflict",
            "App settings changed. Refresh before saving this edit",
          );
        const result = operation(state);
        if (result && typeof result === "object" && "then" in result)
          throw new AppError(
            "invalid_input",
            "Metadata edits cannot await external work",
          );
        if (management) state.revision++;
        // Prune completed summaries only. Live invocations remain visible.
        for (const instance of state.instances) {
          const completed = state.invocations
            .filter(
              (item) => item.instanceId === instance.id && item.finishedAt,
            )
            .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!));
          const keep = new Set(
            completed.slice(0, LIMITS.summaries).map((item) => item.id),
          );
          state.invocations = state.invocations.filter(
            (item) =>
              item.instanceId !== instance.id ||
              !item.finishedAt ||
              keep.has(item.id),
          );
        }
        const validated = appStateSchema.safeParse(state);
        if (!validated.success)
          throw new AppError(
            "conflict",
            validated.error.issues[0]?.message ??
              "App metadata could not be saved",
          );
        fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        atomicWriteFile(this.file, JSON.stringify(validated.data));
        return result;
      }),
    );
    this.tail = edit.catch(() => {});
    return edit;
  }
  /** Runtime activity shares the atomic writer without invalidating a settings review. */
  activity<T>(operation: (state: AppState) => T): Promise<T> {
    return this.edit(undefined, operation, false);
  }
  async recover() {
    await this.edit(undefined, (state) => {
      const now = new Date().toISOString();
      for (const invocation of state.invocations)
        if (!invocation.finishedAt) {
          invocation.finishedAt = now;
          invocation.updatedAt = now;
          invocation.outcome = "interrupted";
        }
      for (const draft of state.drafts)
        if (draft.buildStatus === "building") {
          draft.buildStatus = "failed";
          draft.buildError =
            "The Home stopped during the build. Build this draft again";
          draft.updatedAt = now;
        }
      for (const instance of state.instances)
        if (
          instance.activation &&
          instance.activation.phase !== "active" &&
          instance.activation.phase !== "failed"
        ) {
          instance.activation.phase = "failed";
          instance.enabled = false;
          instance.updatedAt = now;
          for (const grant of state.grants)
            if (grant.instanceId === instance.id) {
              grant.revokedAt = now;
              grant.revision++;
              grant.updatedAt = now;
            }
          for (const job of state.schedules)
            if (job.instanceId === instance.id) job.enabled = false;
          state.panels = state.panels.filter(
            (panel) => panel.instanceId !== instance.id,
          );
        }
      for (const schedule of state.schedules)
        schedule.runningInvocationId = null;
    });
  }
}
export function restoreAppState(state: AppState): AppState {
  const restored = appStateSchema.parse(structuredClone(state)),
    now = new Date().toISOString();
  for (const instance of restored.instances) {
    instance.enabled = false;
    instance.updatedAt = now;
  }
  for (const grant of restored.grants) {
    grant.revokedAt = now;
    grant.revision++;
    grant.updatedAt = now;
  }
  for (const schedule of restored.schedules) {
    schedule.enabled = false;
    schedule.runningInvocationId = null;
    schedule.updatedAt = now;
  }
  restored.panels = [];
  for (const invocation of restored.invocations)
    if (!invocation.finishedAt) {
      invocation.finishedAt = now;
      invocation.outcome = "interrupted";
      invocation.updatedAt = now;
    }
  restored.revision++;
  return restored;
}
