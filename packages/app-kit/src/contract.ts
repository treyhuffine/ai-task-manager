import { z } from "zod/v4";
import { Ajv2020 } from "ajv/dist/2020.js";
import portableSchema from "../schemas/agent-plugins-1.0.0.json" with { type: "json" };

export const HOST_API = 1;
export const LIMITS = Object.freeze({
  instances: 100,
  drafts: 100,
  schedules: 20,
  panels: 200,
  summaries: 100,
  resources: 8,
  skills: 20,
  queued: 32,
  readinessMs: 30_000,
  actionMs: 30_000,
  maxActionMs: 300_000,
  approvalMs: 300_000,
  stopMs: 5_000,
  inputBytes: 1_048_576,
  outputBytes: 8_388_608,
  contextBytes: 8192,
  modelContextBytes: 16_384,
  selections: 50,
  updatesPerSecond: 10,
  logBytes: 10_485_760,
  sourceBytes: 104_857_600,
  serviceBytes: 524_288_000,
});
/** Private management summary, never records, credentials or service endpoints. */
export const serviceStatusSchema = z.object({
  ready: z.boolean(),
  worker: z.object({
    started: z.boolean(), running: z.boolean(),
    lastStartedAt: z.string().max(80).nullable(),
    lastFinishedAt: z.string().max(80).nullable(),
  }).strict(),
  pendingSetup: z.boolean(),
  jobs: z.object({
    states: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,47}$/), z.number().int().min(0).max(100)),
    hasMore: z.boolean(), nextRunAt: z.string().max(80).nullable(),
  }).strict(),
}).strict();
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export const errorCodeSchema = z.enum([
  "invalid_input",
  "not_found",
  "forbidden",
  "revoked",
  "unsupported",
  "conflict",
  "busy",
  "timeout",
  "approval_required",
  "approval_denied",
  "interrupted",
  "app_failed",
]);
export type AppErrorCode = z.infer<typeof errorCodeSchema>;
export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export function publicError(error: unknown): {
  code: AppErrorCode;
  message: string;
} {
  const typed = error instanceof Error && error.name === 'AppError' ? errorCodeSchema.safeParse((error as AppError).code).data : undefined;
  return typed
    ? { code: typed, message: (error as Error).message.slice(0,1000) }
    : {
        code: "app_failed",
        message:
          "The app could not complete this operation. Check its activity and retry.",
      };
}
export const slugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,47}$/)
  .refine(
    (value) => !["new", "drafts"].includes(value),
    "This name is reserved",
  );
export const localNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const relativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !/[\\\x00-\x1f]/.test(value) &&
      !value.startsWith("/") &&
      !/^[A-Za-z]:/.test(value) &&
      value
        .split("/")
        .every((part) => part !== ".." && part !== "" && part !== "."),
    "Use a relative path inside the package",
  );
export const targetSchema = z
  .object({
    platform: z.enum(["darwin", "linux", "win32"]),
    arch: z.enum(["arm64", "x64"]),
    nodeVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    nodeAbi: z.string().regex(/^\d+$/),
  })
  .strict();
export type ArtifactTarget = z.infer<typeof targetSchema>;
const runtimeSchema = z
  .object({
    kind: z.enum(["static", "node"]),
    protocol: z.enum(["ri-ipc-v1", "mcp-http-v1"]).optional(),
    entry: relativePathSchema.optional(),
    start: z.enum(["on-demand", "on-home-start"]).optional(),
    executionProfile: z.literal("trusted-native").optional(),
    mcpPath: z.literal("/mcp").optional(),
    target: targetSchema.optional(),
  })
  .strict();
const resourceSchema = z
  .object({
    uri: z
      .string()
      .regex(/^ui:\/\/[a-z0-9.-]+\/[a-zA-Z0-9/_.-]+\.html$/)
      .max(512),
    file: relativePathSchema.optional(),
  })
  .strict();
export const filePolicySchema = z.object({
  mimeTypes: z.array(z.enum(['text/csv', 'text/plain', 'application/json', 'application/pdf', 'image/png', 'image/jpeg'])).min(1).max(6),
  maxBytes: z.number().int().min(1).max(512 * 1024),
}).strict();
export const fileCapabilitiesSchema = z.object({select: filePolicySchema.optional(), download: filePolicySchema.optional()}).strict();
export type FileCapabilities = z.infer<typeof fileCapabilitiesSchema>;
const requestsSchema = z
  .object({
    integrations: z
      .array(
        z
          .object({
            binding: localNameSchema,
            toolkit: z.string().min(1).max(64),
            actions: z
              .array(z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/))
              .min(1)
              .max(50),
          })
          .strict(),
      )
      .max(20),
    riActions: z.array(localNameSchema).max(20),
    files: fileCapabilitiesSchema.optional(),
  })
  .strict();
export const riExtensionSchema = z
  .object({
    formatVersion: z.literal(1),
    displayName: z.string().min(1).max(100),
    hostApi: z.literal(1),
    suggestedSlug: slugSchema,
    runtime: runtimeSchema,
    build: z
      .object({
        adapter: z.enum(["none", "ri-esbuild-v1", "next-standalone-v1"]),
        lockfile: relativePathSchema.optional(),
        executionProfile: z.literal("trusted-native").optional(),
        recipe:relativePathSchema.optional(),
        output:relativePathSchema.optional(),
      })
      .strict(),
    ui: z
      .object({
        resources: z.array(resourceSchema).min(1).max(LIMITS.resources),
        entrypoints: z
          .array(z.enum(["global", "thread"]))
          .min(1)
          .max(2),
        resolveAction: localNameSchema.optional(),
        contextAction: localNameSchema.optional(),
        access: z.object({path:z.string().regex(/^\/(?!\/)/).max(1024),action:localNameSchema}).strict().optional(),
      })
      .strict().optional(),
    contract: relativePathSchema,
    requests: requestsSchema,
    source: z
      .object({
        kind: z.enum(["personal", "starter", "import"]),
        repository: z.string().url().optional(),
        version: z.string().max(64).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((extension, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const runtime = extension.runtime;
    if (
      runtime.kind === "node" &&
      (!runtime.protocol ||
        !runtime.entry ||
        !runtime.start ||
        !runtime.executionProfile ||
        (extension.ui && !extension.ui?.resolveAction))
    )
      fail(
        "Node apps require protocol, entry, start, profile and a read-only view opener",
      );
    if (
      runtime.kind === "static" &&
      (runtime.protocol ||
        runtime.entry ||
        runtime.start ||
        runtime.executionProfile ||
        runtime.mcpPath ||
        runtime.target ||
        !extension.ui ||
        extension.ui?.resolveAction ||
        extension.ui?.contextAction ||
        extension.ui?.access ||
        extension.ui?.resources.length !== 1)
    )
      fail("Static apps have one resource and no backend");
    if (
      runtime.protocol === "mcp-http-v1" &&
      (!runtime.target ||
        !runtime.mcpPath ||
        extension.build.adapter !== "next-standalone-v1" || !extension.build.recipe || !extension.build.output)
    )
      fail(
        "Service artifacts require an exact runtime target and the qualified service adapter",
      );
    if (extension.build.adapter !== 'next-standalone-v1' && (extension.build.recipe || extension.build.output))
      fail('Service recipes belong only to the qualified service adapter');
    if (extension.build.adapter === 'next-standalone-v1' && (!extension.build.output?.startsWith('release/') || extension.build.recipe?.startsWith('release/')))
      fail('Service output uses the reserved release staging folder, separate from its recipe');
    if (
      runtime.protocol !== "mcp-http-v1" &&
      extension.ui?.resources.some((resource) => !resource.file)
    )
      fail("Local resources require bundled files");
    if (
      runtime.protocol === "mcp-http-v1" &&
      extension.ui?.resources.some((resource) => resource.file)
    )
      fail("Service resources are read through MCP");
    if (
      extension.build.adapter !== "none" &&
      (!extension.build.executionProfile || !extension.build.lockfile)
    )
      fail("Builds require a profile and lockfile");
    if (
      new Set((extension.ui?.resources ?? []).map((resource) => resource.uri)).size !==
      (extension.ui?.resources.length ?? 0)
    )
      fail("Resource URIs must be unique");
  });
export const manifestSchema = z
  .object({
    $schema: z.literal(
      "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    ),
    name: z
      .string()
      .max(64)
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
    description: z.string().min(1).max(1000),
    license: z.string().max(100).optional(),
    author: z
      .object({
        name: z.string().max(200).optional(),
        email: z.string().max(300).optional(),
        url: z.string().url().optional(),
      })
      .strict()
      .optional(),
    homepage: z.string().url().optional(),
    repository: z.string().url().optional(),
    keywords: z.array(z.string().max(100)).max(30).optional(),
    extensions: z
      .object({ "com.ri": riExtensionSchema })
      .catchall(z.record(z.string(), z.unknown())),
  })
  .strict();
export type AppManifest = z.infer<typeof manifestSchema>;
export type RiExtension = z.infer<typeof riExtensionSchema>;
export const jsonSchema = z.record(z.string(), z.unknown());
export const actionSchema = z
  .object({
    name: localNameSchema,
    description: z.string().min(1).max(2000),
    inputSchema: jsonSchema,
    outputSchema: jsonSchema,
    audience: z
      .array(z.enum(["user", "agent", "schedule"]))
      .min(1)
      .max(3),
    effect: z.enum(["read", "app_write", "external_write"]),
    timeoutMs: z.number().int().min(1).max(LIMITS.maxActionMs),
    retry: z.enum(["read_safe", "idempotent", "never_automatic"]),
    errors: z.array(errorCodeSchema).max(20),
    examples: z
      .array(z.object({ input: z.unknown(), output: z.unknown() }).strict())
      .min(1)
      .max(20),
    visibility: z.enum(["app", "model", "both"]),
  })
  .strict();
export type ActionDescriptor = z.infer<typeof actionSchema>;
export const entitySchema = z
  .object({
    type: localNameSchema,
    idField: z.string().min(1),
    titleField: z.string().min(1),
    recordSchema: jsonSchema,
    readAction: localNameSchema.optional(),
    listAction: localNameSchema.optional(),
    searchAction: localNameSchema.optional(),
    openPath: z.string().regex(/^\//).max(1024).optional(),
  })
  .strict();
export const workflowSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    description: z.string().min(1).max(2000),
    file: relativePathSchema,
  })
  .strict();
export const contractSchema = z
  .object({
    formatVersion: z.literal(1),
    packageId: z.string(),
    version: z.string(),
    actions: z.array(actionSchema).max(100),
    entities: z.array(entitySchema).max(30),
    contexts: z.record(z.string(), jsonSchema),
    workflows: z.array(workflowSchema).max(LIMITS.skills),
  })
  .strict();
export type AppContract = z.infer<typeof contractSchema>;
export const principalSchema = z
  .object({
    kind: z.enum([
      "owner-ui",
      "chat",
      "workspace",
      "job",
      "background",
      "fixture",
    ]),
    id: z.string().min(1).max(128),
    fixtureAudience:z.enum(['user','agent']).optional(),
  })
  .strict().refine(value=>value.fixtureAudience===undefined || value.kind==='fixture','Fixture audience is available only in an isolated preview');
export type AppPrincipal = z.infer<typeof principalSchema>;
export const invocationContextSchema = z
  .object({
    id: z.string().uuid(),
    principal: principalSchema,
    audience: z.enum(["user", "agent", "schedule"]),
    grantRevision: z.number().int().nonnegative(),
    deadline: z.number(),
    packageDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type InvocationContext = z.infer<typeof invocationContextSchema>;
export const viewStateSchema = z
  .object({
    formatVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    state: z.unknown(),
  })
  .strict();
export const viewResultSchema = z
  .object({
    resource: z.string(),
    data: z.unknown(),
    scope: z
      .object({
        actions: z.array(localNameSchema).max(100),
        bindings: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export type ViewResult = z.infer<typeof viewResultSchema>;
export const contextResultSchema = z
  .object({
    modelContent: z.string().max(LIMITS.modelContextBytes),
    recordRefs: z
      .array(
        z
          .object({
            instanceId: z.string().uuid(),
            entityType: localNameSchema,
            recordId: z.string().min(1).max(128),
          })
          .strict(),
      )
      .max(LIMITS.selections),
    dataRevision: z.union([z.string().max(128), z.number()]),
  })
  .strict();

/** An instance owns compiled validators. Schemas cannot fetch remote references. */
export class ContractValidator {
  private readonly ajv = new Ajv2020({
    strict: false,
    allErrors: false,
    validateFormats: false,
    ownProperties: true,
  });
  private readonly portable = this.ajv.compile(portableSchema);
  private readonly validators = new Map<
    string,
    ReturnType<Ajv2020["compile"]>
  >();
  manifest(value: unknown): AppManifest {
    if (!this.portable(value))
      throw new AppError(
        "invalid_input",
        "The package does not match the pinned Agent Plugins 1.0 format",
      );
    const result = manifestSchema.safeParse(value);
    if (!result.success)
      throw new AppError(
        "unsupported",
        result.error.issues.map((issue) => issue.message).join(". "),
      );
    return result.data;
  }
  check(
    schema: Record<string, unknown>,
    value: unknown,
    message = "The app returned data outside its contract",
  ): void {
    const key = JSON.stringify(schema);
    if (key.length > 131072 || /"\$ref"\s*:\s*"(?!#)/.test(key))
      throw new AppError(
        "invalid_input",
        "Only bounded local JSON Schemas are supported",
      );
    let validate = this.validators.get(key);
    if (!validate) {
      try {
        validate = this.ajv.compile(schema);
      } catch {
        throw new AppError(
          "invalid_input",
          "The app declares an invalid JSON Schema",
        );
      }
      if (this.validators.size >= 400) this.validators.clear();
      this.validators.set(key, validate);
    }
    if (!validate(value)) throw new AppError("invalid_input", message);
  }
  contract(value: unknown, manifest: AppManifest): AppContract {
    const parsed = contractSchema.safeParse(value);
    if (!parsed.success)
      throw new AppError("invalid_input", "The app contract is invalid");
    const contract = parsed.data;
    const extension = manifest.extensions["com.ri"];
    if (
      contract.packageId !== manifest.name ||
      contract.version !== manifest.version
    )
      throw new AppError(
        "conflict",
        "The package and contract versions disagree",
      );
    if (contract.actions.some(action=>action.name.startsWith('ri_'))) throw new AppError('invalid_input','Action names beginning ri_ are reserved for native host capabilities');
    if (
      new Set(contract.actions.map((action) => action.name)).size !==
      contract.actions.length
    )
      throw new AppError("invalid_input", "Action names must be unique");
    if (
      extension.runtime.kind === "static" &&
      (contract.actions.length || contract.entities.length)
    )
      throw new AppError(
        "invalid_input",
        "Static apps cannot declare backend actions or records",
      );
    if (extension.runtime.kind === 'node' && !extension.ui && !contract.actions.length)
      throw new AppError('invalid_input', 'Tools-only apps need at least one action');
    if (!extension.ui && contract.entities.some(entity => entity.openPath))
      throw new AppError('invalid_input', 'An entity open path requires a view');
    for (const name of [
      extension.ui?.resolveAction,
      extension.ui?.contextAction,
    ]) {
      if (!name) continue;
      const action = contract.actions.find((action) => action.name === name);
      if (!action || action.effect !== "read")
        throw new AppError(
          "invalid_input",
          "View openers and context resolvers must name declared read-only actions",
        );
    }
    if (extension.ui?.access) {
      const action = contract.actions.find(item => item.name === extension.ui?.access!.action);
      const input = action?.inputSchema.properties as Record<string,{type?:string}> | undefined;
      const output = action?.outputSchema.properties as Record<string,{type?:string}> | undefined;
      if (!action?.audience.includes('user') || action.visibility === 'model' || input?.actorId?.type !== 'string' || output?.scopeRef?.type !== 'string')
        throw new AppError('invalid_input','Account access setup must name a declared human callback with actorId input and scopeRef output');
    }
    for (const action of contract.actions)
      for (const fixture of action.examples) {
        this.check(
          action.inputSchema,
          fixture.input,
          `Invalid input fixture for ${action.name}`,
        );
        this.check(
          action.outputSchema,
          fixture.output,
          `Invalid output fixture for ${action.name}`,
        );
      }
    for (const entity of contract.entities)
      for (const name of [
        entity.readAction,
        entity.listAction,
        entity.searchAction,
      ]) {
        if (name && !contract.actions.some((action) => action.name === name))
          throw new AppError(
            "invalid_input",
            "An entity names an unknown action",
          );
        if (name && [entity.listAction, entity.searchAction].includes(name)) {
          const input = contract.actions.find(
            (action) => action.name === name,
          )!.inputSchema;
          if (!input.properties || !("limit" in (input.properties as object)))
            throw new AppError(
              "invalid_input",
              "Entity list and search actions must paginate",
            );
        }
      }
    for (const uri of Object.keys(contract.contexts))
      if (!extension.ui?.resources.some((resource) => resource.uri === uri))
        throw new AppError(
          "invalid_input",
          "A context schema names an undeclared resource",
        );
    return contract;
  }
}
