import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AppError,
  ContractValidator,
  LIMITS,
  publicError,
  errorCodeSchema,
  serviceStatusSchema,
  type AppManifest,
  type AppContract,
  type ActionDescriptor,
  type InvocationContext,
  type AppPrincipal,
  type ArtifactTarget,
} from "./contract.js";
import { contractDigest } from "./sdk.js";
import { allocateLoopbackPort, McpServiceTransport } from "./mcp-service.js";
import {kitAsset} from './assets.js';

export interface Artifact {
  manifest: AppManifest;
  contract: AppContract;
  digest: string;
  packageDir: string;
}
export interface InstalledArtifact extends Artifact {
  instanceId: string;
  dataDir: string;
  cacheDir: string;
  logsDir: string;
}
export type RuntimeCondition =
  | "stopped"
  | "starting"
  | "running"
  | "waiting_approval"
  | "failed";
export interface RuntimeEvent {
  instanceId: string;
  kind: "condition" | "invocation" | "change";
  invocationId?: string;
  condition?: RuntimeCondition;
  outcome?: string;
  action?: string;
  principal?: AppPrincipal;
  grantRevision?: number;
  packageDigest?: string;
  startedAt?: number;
  finishedAt?: number;
}
export interface CapabilityCall {
  callId: string;
  name: string;
  binding?: string;
  input: unknown;
}
export interface HostServices {
  version: 1;
  authorize(
    instance: InstalledArtifact,
    action: ActionDescriptor,
    context: InvocationContext,
  ): Promise<void> | void;
  capability(
    instance: InstalledArtifact,
    context: InvocationContext,
    call: CapabilityCall,
    signal: AbortSignal,
  ): Promise<unknown>;
  event(event: RuntimeEvent): Promise<void> | void;
  beginActivity?(): () => void;
  serviceScope?(
    instance: InstalledArtifact,
    context: InvocationContext,
  ): Promise<string | null>;
  serviceBootstrap?(
    instance: InstalledArtifact,
    generation: string,
  ): Promise<Record<string, unknown>>;
  serviceInvocation?(
    instance: InstalledArtifact,
    context: InvocationContext,
  ): Promise<{ scopeRef: string | null; ticket: string | null; scopeActorId?: string }>;
}
export interface OwnedTransport {
  generation: string;
  pid: number;
  request(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;
  onCapability(
    handler: (
      call: CapabilityCall & { invocationId: string },
    ) => Promise<unknown>,
  ): void;
  onExit(handler: () => void): void;
  stop(): Promise<void>;
}
export interface ExecutionDriver {
  profile: "trusted-native";
  prepare(artifact: Artifact, signal?: AbortSignal): Promise<void>;
  start(
    instance: InstalledArtifact,
    bootstrap: Record<string, unknown>,
    scope?: (
      context: InvocationContext,
    ) => Promise<{ scopeRef: string | null; ticket: string | null; scopeActorId?: string }>,
  ): Promise<OwnedTransport>;
  stop(transport: OwnedTransport): Promise<void>;
  dispose(): Promise<void>;
}
const exec = promisify(execFile);
export async function inspectNode(executable: string): Promise<ArtifactTarget> {
  const { stdout } = await exec(
    executable,
    [
      "--input-type=module",
      "-e",
      "process.stdout.write(JSON.stringify({platform:process.platform,arch:process.arch,nodeVersion:process.versions.node,nodeAbi:process.versions.modules}))",
    ],
    { timeout: 5000, env: { PATH: path.dirname(executable) }, maxBuffer: 4096 },
  );
  return JSON.parse(stdout) as ArtifactTarget;
}
export function assertTarget(
  expected: ArtifactTarget | undefined,
  actual: ArtifactTarget,
): void {
  if (
    expected &&
    Object.keys(expected).some(
      (key) =>
        expected[key as keyof ArtifactTarget] !==
        actual[key as keyof ArtifactTarget],
    )
  )
    throw new AppError(
      "unsupported",
      "This service artifact does not support the Node runtime and platform used by this Home",
    );
}
export function runtimeEnvironment(
  node: string,
  tempDir: string,
): NodeJS.ProcessEnv {
  return {
    PATH: `${path.dirname(node)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    LANG: "en_US.UTF-8",
    TZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
    TMPDIR: tempDir,
  };
}
class IpcTransport implements OwnedTransport {
  readonly pid: number;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
      cleanup: () => void;
    }
  >();
  private capability?: (
    call: CapabilityCall & { invocationId: string },
  ) => Promise<unknown>;
  private exits: (() => void)[] = [];
  private stopped = false;
  constructor(
    private readonly child: ChildProcess,
    readonly generation: string,
    logsDir: string,
  ) {
    this.pid = child.pid!;
    const log = path.join(logsDir, "runtime.log");
    const append = (chunk: Buffer) => {
      // Bound every chunk and rotate the entire inventory to 10 MiB.
      const value = chunk.subarray(0, 65536);
      try {
        const size = fs.existsSync(log) ? fs.statSync(log).size : 0;
        if (size + value.byteLength > LIMITS.logBytes / 2) {
          fs.rmSync(`${log}.1`, { force: true });
          fs.renameSync(log, `${log}.1`);
        }
        fs.appendFileSync(log, value, { mode: 0o600 });
      } catch {
        /* Diagnostics cannot break lifecycle ownership. */
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("message", (message) => {
      void this.receive(message);
    });
    child.on("error", () => this.closed());
    child.on("exit", () => this.closed());
  }
  private closed() {
    if (this.stopped) return;
    this.stopped = true;
    for (const item of this.pending.values()) {
      item.cleanup();
      item.reject(new AppError("interrupted", "The app process stopped"));
    }
    this.pending.clear();
    for (const callback of this.exits) callback();
  }
  private async receive(value: unknown) {
    if (!value || typeof value !== "object") return;
    const message = value as {
      version: number;
      id: string;
      method?: string;
      params?: unknown;
      error?: { code: string; message: string };
      result?: unknown;
    };
    if (message.version !== 1 || typeof message.id !== "string") return;
    if (Buffer.byteLength(JSON.stringify(value)) > LIMITS.outputBytes) {
      await this.stop();
      return;
    }
    if (message.method === "capability") {
      try {
        const params = message.params as {
          invocationId: string;
          name: string;
          binding?: string;
          input: unknown;
        };
        if (
          !this.capability ||
          typeof params.invocationId !== "string" ||
          typeof params.name !== "string"
        )
          throw new AppError("forbidden", "Invalid capability request");
        const result = await this.capability({ ...params, callId: message.id });
        if (this.child.connected)
          this.child.send({ version: 1, id: message.id, result });
      } catch (error) {
        if (this.child.connected)
          this.child.send({
            version: 1,
            id: message.id,
            error: publicError(error),
          });
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    pending.cleanup();
    if (message.error)
      pending.reject(
        new AppError(
          errorCodeSchema.safeParse(message.error.code).data ?? 'app_failed',
          typeof message.error.message === 'string' ? message.error.message.slice(0,1000) : 'The app action failed',
        ),
      );
    else pending.resolve(message.result);
  }
  request(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.stopped || !this.child.connected)
      return Promise.reject(new AppError("app_failed", "The app is stopped"));
    if (signal?.aborted)
      return Promise.reject(
        new AppError("interrupted", "The invocation was cancelled"),
      );
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(new AppError("interrupted", "The invocation was cancelled"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", abort),
      });
      this.child.send({ version: 1, id, method, params }, (error) => {
        if (error) {
          this.pending.delete(id);
          signal?.removeEventListener("abort", abort);
          reject(new AppError("interrupted", "The app disconnected"));
        }
      });
    });
  }
  onCapability(
    handler: (
      call: CapabilityCall & { invocationId: string },
    ) => Promise<unknown>,
  ) {
    this.capability = handler;
  }
  onExit(handler: () => void) {
    this.exits.push(handler);
  }
  async stop() {
    if (this.stopped) return;
    // The guard owns this live group. Disconnect remains effective when app
    // JavaScript or a native extension is blocked and cannot process shutdown.
    const done = new Promise<void>((resolve) =>
      this.child.once("exit", () => resolve()),
    );
    if (this.child.connected) this.child.disconnect();
    const timer = setTimeout(() => {
      if (!this.stopped) {
        try {
          process.kill(-this.pid, "SIGKILL");
        } catch {}
      }
    }, LIMITS.stopMs + 100);
    await done;
    clearTimeout(timer);
  }
}
export class NativeNodeDriver implements ExecutionDriver {
  readonly profile = "trusted-native" as const;
  private readonly owned = new Set<OwnedTransport>();
  constructor(readonly nodeExecutable: string) {}
  async prepare(artifact: Artifact, signal?: AbortSignal) {
    if (signal?.aborted)
      throw new AppError("interrupted", "Preparation was cancelled");
    const runtime = artifact.manifest.extensions["com.ri"].runtime;
    if (runtime.kind === "node" && runtime.executionProfile !== this.profile)
      throw new AppError(
        "unsupported",
        "This execution profile is not available",
      );
    if (
      artifact.manifest.extensions["com.ri"].build.adapter !== "none" &&
      artifact.manifest.extensions["com.ri"].build.executionProfile !==
        this.profile
    )
      throw new AppError("unsupported", "This build profile is not available");
    assertTarget(runtime.target, await inspectNode(this.nodeExecutable));
  }
  async start(
    instance: InstalledArtifact,
    bootstrap: Record<string, unknown>,
    scope?: (
      context: InvocationContext,
    ) => Promise<{ scopeRef: string | null; ticket: string | null; scopeActorId?: string }>,
    attempt = 0,
  ): Promise<OwnedTransport> {
    await this.prepare(instance);
    const runtime = instance.manifest.extensions["com.ri"].runtime;
    if (runtime.kind !== "node" || !runtime.entry)
      throw new AppError("unsupported", "Static apps have no process");
    for (const dir of [instance.dataDir, instance.cacheDir, instance.logsDir])
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const generation =
      typeof bootstrap.generation === "string"
        ? bootstrap.generation
        : randomUUID();
    const port =
      runtime.protocol === "mcp-http-v1" ? await allocateLoopbackPort() : null;
    const child = spawn(
      this.nodeExecutable,
      [
        kitAsset('owned-runner.cjs'),
        path.join(instance.packageDir, runtime.entry),
        "--ownership",
        generation,
      ],
      {
        shell: false,
        detached: true,
        cwd: instance.packageDir,
        env: runtimeEnvironment(this.nodeExecutable, instance.cacheDir),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", () =>
        reject(new AppError("app_failed", "The Node runtime could not start")),
      );
    });
    const ownership = path.join(instance.cacheDir, "ownership.json");
    fs.writeFileSync(
      ownership,
      JSON.stringify({ version: 1, pid: child.pid, generation }),
      { mode: 0o600 },
    );
    const transport = new IpcTransport(child, generation, instance.logsDir);
    this.owned.add(transport);
    transport.onExit(() => this.owned.delete(transport));
    transport.onExit(() => {
      try {
        const current = JSON.parse(fs.readFileSync(ownership, "utf8"));
        if (current.pid === child.pid && current.generation === generation)
          fs.rmSync(ownership, { force: true });
      } catch {
        /* Offline backup verifies a leftover ownership record against the live process. */
      }
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIMITS.readinessMs);
    try {
      const result = (await transport.request(
        "initialize",
        {
          version: 1,
          instanceId: instance.instanceId,
          dataDir: instance.dataDir,
          cacheDir: instance.cacheDir,
          packageDigest: instance.digest,
          contractDigest: contractDigest(instance.contract),
          contract: instance.contract,
          bindings: instance.manifest.extensions[
            "com.ri"
          ].requests.integrations.map((item) => item.binding),
          ...bootstrap,
          port,
        },
        controller.signal,
      )) as { version: number; contractDigest: string; endpoint?: string };
      if (
        result.version !== 1 ||
        result.contractDigest !== contractDigest(instance.contract)
      )
        throw new AppError(
          "conflict",
          "The app did not confirm the installed contract",
        );
      if (runtime.protocol === "mcp-http-v1") {
        const endpoint = `http://127.0.0.1:${port}${runtime.mcpPath}`;
        if (result.endpoint !== endpoint)
          throw new AppError(
            "forbidden",
            "The service did not bind the assigned loopback endpoint",
          );
        const service = new McpServiceTransport(
          transport,
          instance,
          endpoint,
          scope ?? (async () => ({ scopeRef: null, ticket: null })),
        );
        await service.qualify(controller.signal);
        return service;
      }
      return transport;
    } catch (error) {
      await transport.stop();
      if (runtime.protocol === 'mcp-http-v1' && attempt < 2 && error instanceof AppError && error.message.includes('EADDRINUSE')) return this.start(instance, bootstrap, scope, attempt + 1);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  stop(transport: OwnedTransport) {
    return transport.stop();
  }
  async dispose() {
    await Promise.allSettled(
      [...this.owned].map((transport) => transport.stop()),
    );
  }
}
interface Active {
  context: InvocationContext;
  action: ActionDescriptor;
  input: unknown;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  remaining: number;
  resumedAt: number;
  waiting: boolean;
  release?: () => void;
}
interface Slot {
  artifact: InstalledArtifact;
  condition: RuntimeCondition;
  transport?: OwnedTransport;
  terminating?: Promise<void>;
  starting?: Promise<OwnedTransport>;
  active?: Active;
  queue: number;
  tail: Promise<void>;
  starts: number[];
  stopping: boolean;
}
export class AppEngine {
  readonly version = 1;
  private readonly slots = new Map<string, Slot>();
  private readonly validator = new ContractValidator();
  private readonly identities = new Map<string, string>();
  private readonly pendingIdentities = new Map<string, number>();
  private admission = true;
  constructor(
    readonly host: HostServices,
    readonly driver: ExecutionDriver,
  ) {
    if (host.version !== 1)
      throw new AppError("unsupported", "Unsupported host services version");
  }
  condition(instanceId: string) {
    const slot = this.slots.get(instanceId);
    return {
      condition: slot?.condition ?? "stopped",
      invocationId: slot?.active?.context.id ?? null,
      queued: slot?.queue ?? 0,
    };
  }
  async serviceStatus(instanceId: string) {
    const slot = this.slots.get(instanceId), transport = slot?.transport;
    if (!transport || slot?.artifact.manifest.extensions['com.ri'].runtime.protocol !== 'mcp-http-v1') return null;
    const result = await transport.request('status', {}, AbortSignal.timeout(5000));
    if (slot.transport !== transport || slot.stopping)
      throw new AppError('revoked', 'The service changed while its status was being read');
    if ((JSON.stringify(result) ?? "").length > 16384)
      throw new AppError('invalid_input', 'The service status is too large');
    const parsed = serviceStatusSchema.safeParse(result);
    if (!parsed.success) throw new AppError('invalid_input', 'The service returned an invalid status summary');
    return parsed.data;
  }
  invocationSignal(instanceId: string, invocationId: string) {
    const active = this.slots.get(instanceId)?.active;
    if (
      !active ||
      active.context.id !== invocationId ||
      active.controller.signal.aborted
    )
      throw new AppError("revoked", "This invocation is no longer active");
    return active.controller.signal;
  }
  private conditionEvent(slot: Slot, condition: RuntimeCondition) {
    slot.condition = condition;
    void this.host.event({
      instanceId: slot.artifact.instanceId,
      kind: "condition",
      condition,
      invocationId: slot.active?.context.id,
    });
  }
  private slot(instance: InstalledArtifact) {
    let slot = this.slots.get(instance.instanceId);
    if (slot && slot.artifact.digest !== instance.digest)
      throw new AppError(
        "conflict",
        "Stop the previous app version before activation",
      );
    if (!slot) {
      slot = {
        artifact: instance,
        condition: "stopped",
        queue: 0,
        tail: Promise.resolve(),
        starts: [],
        stopping: false,
      };
      this.slots.set(instance.instanceId, slot);
    }
    return slot;
  }
  private async ensureStarted(slot: Slot): Promise<OwnedTransport> {
    if(slot.terminating)await slot.terminating;
    if(slot.stopping)throw new AppError("interrupted","The app is stopping");
    if (slot.transport) return slot.transport;
    if (slot.starting) return slot.starting;
    slot.starts = slot.starts.filter((time) => time > Date.now() - 300000);
    if (slot.starts.length >= 3)
      throw new AppError(
        "app_failed",
        "This app failed to start repeatedly. Use Retry to try again",
      );
    slot.starts.push(Date.now());
    this.conditionEvent(slot, "starting");
    slot.starting = (async () => {
      const generation = randomUUID();
      const bootstrap = {
        ...((await this.host.serviceBootstrap?.(slot.artifact, generation)) ??
          {}),
        generation,
      };
      const transport = await this.driver.start(
        slot.artifact,
        bootstrap,
        (context) =>
          this.host.serviceInvocation?.(slot.artifact, context) ??
          Promise.resolve({ scopeRef: null, ticket: null }),
      );
      transport.onCapability(async (call) => {
        const active = slot.active;
        if (
          !active ||
          active.context.id !== call.invocationId ||
          active.controller.signal.aborted
        )
          throw new AppError("revoked", "This invocation is no longer active");
        await this.host.authorize(slot.artifact, active.action, active.context);
        const result = await this.host.capability(
          slot.artifact,
          active.context,
          call,
          active.controller.signal,
        );
        await this.host.authorize(slot.artifact, active.action, active.context);
        return result;
      });
      transport.onExit(() => {
        if(slot.transport!==transport)return;
        slot.transport = undefined;
        slot.active?.controller.abort();
        this.conditionEvent(slot, "failed");
      });
      slot.transport = transport;
      this.conditionEvent(slot, "running");
      return transport;
    })();
    try {
      return await slot.starting;
    } catch (error) {
      this.conditionEvent(slot, "failed");
      throw error;
    } finally {
      slot.starting = undefined;
    }
  }
  async start(instance: InstalledArtifact) {
    if (!this.admission) throw new AppError("busy", "App work is paused");
    await this.ensureStarted(this.slot(instance));
  }
  async resource(
    instance: InstalledArtifact,
    uri: string,
    principal: AppPrincipal,
    grantRevision: number,
  ) {
    if (!this.admission) throw new AppError("busy", "App work is paused");
    const opener = instance.contract.actions.find(
      (action) =>
        action.name === instance.manifest.extensions["com.ri"].ui?.resolveAction,
    )!;
    const context: InvocationContext = {
      id: randomUUID(),
      principal,
      audience: principal.kind === "owner-ui" ? "user" : "agent",
      grantRevision,
      deadline: Date.now() + LIMITS.actionMs,
      packageDigest: instance.digest,
    };
    await this.host.authorize(instance, opener, context);
    const transport = await this.ensureStarted(this.slot(instance));
    const result = await transport.request(
      "resource",
      { uri, context },
      AbortSignal.timeout(LIMITS.actionMs),
    );
    await this.host.authorize(instance, opener, context);
    return result;
  }
  private arm(slot: Slot, active: Active) {
    active.resumedAt = Date.now();
    active.timer = setTimeout(() => {
      active.controller.abort(
        new AppError("timeout", "The app action timed out"),
      );
      void this.stopTransport(slot);
    }, active.remaining);
  }
  pauseForApproval(instanceId: string, invocationId: string): () => void {
    const slot = this.slots.get(instanceId),
      active = slot?.active;
    if (
      !slot ||
      !active ||
      active.context.id !== invocationId ||
      active.waiting
    )
      throw new AppError("conflict", "The invocation cannot wait for approval");
    clearTimeout(active.timer);
    active.remaining -= Date.now() - active.resumedAt;
    active.waiting = true;
    this.conditionEvent(slot, "waiting_approval");
    active.timer = setTimeout(
      () => this.cancel(instanceId, invocationId),
      LIMITS.approvalMs,
    );
    let resumed = false;
    return () => {
      if (resumed || active.controller.signal.aborted) return;
      resumed = true;
      clearTimeout(active.timer);
      active.waiting = false;
      this.conditionEvent(slot, "running");
      this.arm(slot, active);
    };
  }
  cancel(instanceId: string, invocationId: string) {
    const slot = this.slots.get(instanceId);
    if (slot?.active?.context.id !== invocationId) return;
    slot.active.controller.abort();
    void this.stopTransport(slot);
  }
  async invoke(
    instance: InstalledArtifact,
    actionName: string,
    input: unknown,
    principal: AppPrincipal,
    grantRevision: number,
    invocationId: string = randomUUID(),
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.admission) throw new AppError("busy", "App work is paused");
    const action = instance.contract.actions.find(
      (item) => item.name === actionName,
    );
    if (!action) throw new AppError("not_found", "Unknown app action");
    const audience =
      principal.kind === "owner-ui" || principal.kind === "fixture" && principal.fixtureAudience === "user"
        ? "user"
        : ["job", "background"].includes(principal.kind)
          ? "schedule"
          : "agent";
    if (!action.audience.includes(audience))
      throw new AppError(
        "forbidden",
        "This action is unavailable to this caller",
      );
    const serializedInput = JSON.stringify(input);
    if (serializedInput === undefined || Buffer.byteLength(serializedInput) > LIMITS.inputBytes)
      throw new AppError("invalid_input", "App input is too large");
    this.validator.check(
      action.inputSchema,
      input,
      "The action input is invalid",
    );
    const context: InvocationContext = {
      id: invocationId,
      principal,
      audience,
      grantRevision,
      deadline: Date.now() + action.timeoutMs,
      packageDigest: instance.digest,
    };
    await this.host.authorize(instance, action, context);
    const identity = createHash("sha256")
      .update(
        JSON.stringify([instance.instanceId, principal, actionName, input]),
      )
      .digest("hex");
    const previous = this.identities.get(invocationId);
    if (previous && previous !== identity)
      throw new AppError(
        "conflict",
        "This invocation ID belongs to another operation",
      );
    // The persistent SDK receipt owns business deduplication. Bound the host's
    // recent identity cache without discarding an active or queued identity.
    if (!previous && this.identities.size >= 10000) {
      for (const id of this.identities.keys()) {
        if (!this.pendingIdentities.has(id)) { this.identities.delete(id); break; }
      }
    }
    this.identities.set(invocationId, identity);
    const slot = this.slot(instance);
    if (slot.queue >= LIMITS.queued)
      throw new AppError("busy", "This app has too many pending calls");
    slot.queue++;
    this.pendingIdentities.set(invocationId, (this.pendingIdentities.get(invocationId) ?? 0) + 1);
    const before = slot.tail;
    let releaseQueue!: () => void;
    slot.tail = new Promise((resolve) => {
      releaseQueue = resolve;
    });
    await before;
    slot.queue--;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const active: Active = {
      context,
      action,
      input,
      controller,
      remaining: action.timeoutMs,
      resumedAt: Date.now(),
      waiting: false,
    };
    const startedAt = Date.now();
    try {
      if (controller.signal.aborted || slot.stopping || !this.admission)
        throw new AppError("interrupted", "The invocation was cancelled");
      await this.host.authorize(instance, action, context);
      active.release = this.host.beginActivity?.();
      slot.active = active;
      await this.host.event({
        instanceId: instance.instanceId,
        kind: "invocation",
        invocationId,
        action: actionName,
        principal,
        grantRevision,
        packageDigest: instance.digest,
        startedAt,
        outcome: "running",
      });
      const transport = await this.ensureStarted(slot);
      this.arm(slot, active);
      const result = await transport.request(
        "invoke",
        { action: actionName, input, context },
        controller.signal,
      );
      const serializedResult = JSON.stringify(result);
      if (serializedResult === undefined || Buffer.byteLength(serializedResult) > LIMITS.outputBytes)
        throw new AppError("invalid_input", "The app result is too large");
      this.validator.check(action.outputSchema, result);
      await this.host.authorize(instance, action, context);
      await this.host.event({
        instanceId: instance.instanceId,
        kind: "invocation",
        invocationId,
        action: actionName,
        startedAt,
        finishedAt: Date.now(),
        outcome: "success",
      });
      if (action.effect !== "read")
        await this.host.event({
          instanceId: instance.instanceId,
          kind: "change",
          invocationId,
        });
      return result;
    } catch (error) {
      const outcome =
        controller.signal.reason instanceof AppError
          ? controller.signal.reason.code
          : controller.signal.aborted
            ? "interrupted"
            : publicError(error).code;
      await this.host.event({
        instanceId: instance.instanceId,
        kind: "invocation",
        invocationId,
        action: actionName,
        startedAt,
        finishedAt: Date.now(),
        outcome,
      });
      if (controller.signal.aborted)
        throw new AppError(
          outcome as AppError["code"],
          outcome === "timeout"
            ? "The app action timed out"
            : "The invocation was cancelled",
        );
      throw error;
    } finally {
      clearTimeout(active.timer);
      signal?.removeEventListener("abort", abort);
      active.release?.();
      const remaining = (this.pendingIdentities.get(invocationId) ?? 1) - 1;
      if (remaining) this.pendingIdentities.set(invocationId, remaining);
      else this.pendingIdentities.delete(invocationId);
      if (slot.active === active) slot.active = undefined;
      releaseQueue();
    }
  }
  private async stopTransport(slot:Slot) {
    if(slot.terminating)return slot.terminating;
    const transport=slot.transport;
    if(!transport)return;
    slot.transport=undefined;
    const terminating=transport.stop();slot.terminating=terminating;
    try{await terminating;}finally{if(slot.terminating===terminating){slot.terminating=undefined;this.conditionEvent(slot,'stopped');}}
  }
  async stop(instanceId: string) {
    const slot = this.slots.get(instanceId);
    if (!slot) return;
    slot.stopping = true;
    slot.active?.controller.abort();
    if (slot.starting) await slot.starting.catch(() => {});
    await this.stopTransport(slot);
    await slot.tail;
    this.slots.delete(instanceId);
    await this.host.event({
      instanceId,
      kind: "condition",
      condition: "stopped",
    });
  }
  retry(instanceId: string) {
    const slot = this.slots.get(instanceId);
    if (slot) slot.starts = [];
  }
  async quiesce() {
    this.admission = false;
    await Promise.allSettled([...this.slots.keys()].map((id) => this.stop(id)));
  }
  resume() {
    this.admission = true;
  }
  async dispose() {
    await this.quiesce();
    await this.driver.dispose();
  }
}
