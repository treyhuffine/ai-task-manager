import { z } from "zod/v4";
import { createHash, randomUUID } from "node:crypto";
import {
  AppError,
  ContractValidator,
  LIMITS,
  invocationContextSchema,
  publicError,
  type ActionDescriptor,
  type AppContract,
  type InvocationContext,
} from "./contract.js";

export interface AppInvocation extends InvocationContext {
  signal: AbortSignal;
  capability(name: string, input: unknown, binding?: string): Promise<unknown>;
}
export interface ActionDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  audience: ActionDescriptor["audience"];
  effect: ActionDescriptor["effect"];
  timeoutMs?: number;
  retry: ActionDescriptor["retry"];
  errors?: ActionDescriptor["errors"];
  visibility?: ActionDescriptor["visibility"];
  examples: { input: I; output: O }[];
  handler(input: I, context: AppInvocation): Promise<O> | O;
}
export function defineAction<I, O>(
  definition: ActionDefinition<I, O>,
): ActionDefinition<I, O> {
  return definition;
}
export interface AppDefinition {
  packageId: string;
  version: string;
  // Handlers retain their own inferred types through defineAction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: ActionDefinition<any, any>[];
  entities?: AppContract["entities"];
  contexts?: Record<string, z.ZodType>;
}
export function generateContract(
  definition: AppDefinition,
  workflows: AppContract["workflows"] = [],
): AppContract {
  return {
    formatVersion: 1,
    packageId: definition.packageId,
    version: definition.version,
    actions: definition.actions.map((action) => ({
      name: action.name,
      description: action.description,
      inputSchema: z.toJSONSchema(action.input, { io: "input" }) as Record<
        string,
        unknown
      >,
      outputSchema: z.toJSONSchema(action.output) as Record<string, unknown>,
      audience: action.audience,
      effect: action.effect,
      timeoutMs: action.timeoutMs ?? LIMITS.actionMs,
      retry: action.retry,
      errors: action.errors ?? ["invalid_input", "forbidden", "conflict"],
      examples: action.examples,
      visibility: action.visibility ?? "both",
    })),
    entities: definition.entities ?? [],
    contexts: Object.fromEntries(
      Object.entries(definition.contexts ?? {}).map(([uri, schema]) => [
        uri,
        z.toJSONSchema(schema) as Record<string, unknown>,
      ]),
    ),
    workflows,
  };
}
export function contractDigest(contract: AppContract): string {
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}
export interface Bootstrap {
  dataDir: string;
  cacheDir: string;
  packageDigest: string;
  contractDigest: string;
  contract: AppContract;
  bindings: string[];
  instanceId: string;
}
export interface AppLifecycle {
  initialize(bootstrap: Bootstrap): Promise<void> | void;
  shutdown?(): Promise<void> | void;
}
type Wire = {
  version: 1;
  id: string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: string; message: string };
};
export interface ChildChannel {
  connected: boolean;
  send(message: unknown, callback?: (error: Error | null) => void): boolean;
  on(event: "message", handler: (message: unknown) => void): unknown;
  on(event: "disconnect", handler: () => void): unknown;
}
/** Start only from the packaged executable entry. Build-time contract generation
 * imports definitions without calling this function or opening app storage. */
export function serveApp(
  definition: AppDefinition,
  lifecycle: AppLifecycle,
  channel: ChildChannel = process as unknown as ChildChannel,
): void {
  if (!channel.send)
    throw new AppError(
      "unsupported",
      "This app requires the private host IPC channel",
    );
  const calls = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();
  const running = new Map<string, AbortController>();
  let initialized = false;
  let boot: Bootstrap;
  const validator = new ContractValidator();
  const reply = (id: string, result: unknown) =>
    channel.send({ version: 1, id, result });
  const fail = (id: string, error: unknown) =>
    channel.send({ version: 1, id, error: publicError(error) });
  async function handle(message: Wire) {
    if (message.version !== 1 || typeof message.id !== "string") return;
    if (!message.method) {
      const call = calls.get(message.id);
      if (!call) return;
      calls.delete(message.id);
      if (message.error)
        call.reject(
          new AppError(
            message.error.code as AppError["code"],
            message.error.message,
          ),
        );
      else call.resolve(message.result);
      return;
    }
    try {
      if (message.method === "initialize") {
        if (initialized) throw new AppError("conflict", "Already initialized");
        boot = message.params as Bootstrap;
        const generated = generateContract(definition, boot.contract.workflows);
        if (contractDigest(generated) !== boot.contractDigest)
          throw new AppError(
            "conflict",
            "The executable and installed contract disagree",
          );
        await lifecycle.initialize(boot);
        initialized = true;
        reply(message.id, { version: 1, contractDigest: boot.contractDigest });
      } else if (message.method === "invoke") {
        if (!initialized)
          throw new AppError("app_failed", "The app is not ready");
        const params = message.params as {
          action: string;
          input: unknown;
          context: unknown;
        };
        const context = invocationContextSchema.parse(params.context);
        const action = definition.actions.find(
          (action) => action.name === params.action,
        );
        if (!action) throw new AppError("not_found", "Unknown app action");
        const controller = new AbortController();
        running.set(context.id, controller);
        try {
          const result = await action.handler(
            action.input.parse(params.input),
            {
              ...context,
              signal: controller.signal,
              capability: (name, input, binding) =>
                new Promise((resolve, reject) => {
                  if (controller.signal.aborted) {
                    reject(
                      new AppError(
                        "interrupted",
                        "The invocation was cancelled",
                      ),
                    );
                    return;
                  }
                  const id = randomUUID();
                  calls.set(id, { resolve, reject });
                  channel.send(
                    {
                      version: 1,
                      id,
                      method: "capability",
                      params: {
                        invocationId: context.id,
                        name,
                        input,
                        binding,
                      },
                    },
                    (error) => {
                      if (error) {
                        calls.delete(id);
                        reject(
                          new AppError("interrupted", "The host disconnected"),
                        );
                      }
                    },
                  );
                }),
            },
          );
          if (controller.signal.aborted)
            throw new AppError("interrupted", "The invocation was cancelled");
          validator.check(
            boot.contract.actions.find((item) => item.name === action.name)!
              .outputSchema,
            result,
          );
          reply(message.id, result);
        } finally {
          running.delete(context.id);
        }
      } else if (message.method === "cancel") {
        const id = (message.params as { invocationId: string }).invocationId;
        running.get(id)?.abort();
        for (const [callId, call] of calls) {
          call.reject(
            new AppError("interrupted", "The invocation was cancelled"),
          );
          calls.delete(callId);
        }
        reply(message.id, {});
      } else if (message.method === "shutdown") {
        for (const controller of running.values()) controller.abort();
        await lifecycle.shutdown?.();
        reply(message.id, {});
      } else throw new AppError("unsupported", "Unknown host operation");
    } catch (error) {
      fail(
        message.id,
        error instanceof z.ZodError
          ? new AppError("invalid_input", "The action input is invalid")
          : error,
      );
    }
  }
  channel.on("message", (message) => {
    void handle(message as Wire);
  });
  channel.on("disconnect", () => {
    for (const controller of running.values()) controller.abort();
    void Promise.resolve(lifecycle.shutdown?.()).finally(() => process.exit(0));
  });
}

/** Persist mutation IDs with the business write in the same app transaction.
 * This wrapper deliberately uses only Node's qualified SQLite built-in. */
export async function openAppDatabase(file: string) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS app_invocations (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, input_digest TEXT NOT NULL, result TEXT NOT NULL)",
  );
  return {
    db,
    mutate<T>(
      invocation: AppInvocation,
      action: string,
      input: unknown,
      operation: () => T,
    ): T {
      const digest = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      db.exec("BEGIN IMMEDIATE");
      try {
        const actor = JSON.stringify(invocation.principal);
        const prior = db
          .prepare(
            "SELECT actor,action,input_digest,result FROM app_invocations WHERE id=?",
          )
          .get(invocation.id);
        if (prior) {
          if (
            prior.actor !== actor ||
            prior.action !== action ||
            prior.input_digest !== digest
          )
            throw new AppError(
              "conflict",
              "This invocation ID belongs to a different change",
            );
          db.exec("COMMIT");
          return JSON.parse(String(prior.result)) as T;
        }
        const result = operation();
        db.prepare(
          "INSERT INTO app_invocations (id,actor,action,input_digest,result) VALUES (?,?,?,?,?)",
        ).run(invocation.id, actor, action, digest, JSON.stringify(result));
        db.exec("COMMIT");
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
