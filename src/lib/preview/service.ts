/**
 * Preview orchestration — the layer the API routes call. Ties together the
 * desired-state record (`preview_targets`), the process supervisor, and the
 * providers (localhost / beamd / portless / manual).
 *
 * The flow for "give me a reachable URL":
 *   1. Resolve the worktree context (cwd + name) from the execution.
 *   2. Ensure a `preview_targets` row exists with a stable port + DNS name.
 *   3. If the chosen provider manages the local server, start it and
 *      confirm it's listening (lazy cold-start — a Flow/host restart is a
 *      non-event because bring-up is on first resolve).
 *   4. Route through the provider to get the URL.
 *
 * Source of truth is Flow, not beamd: only Flow knows the start command, so
 * Flow owns "what should be running" and beamd stays stateless about it.
 */

import path from 'node:path';
import {
  getExecution,
  getWorkspace,
  getPreviewTarget,
  getPreviewTargetById,
  createPreviewTarget,
  updatePreviewTarget,
  touchPreviewTarget,
  listPreviewTargetsForExecution,
  listPinnedPreviewTargetsForWorkspace,
  setExecutionPreviewUrls,
} from '@/lib/db/queries';
import type { ExecutionRecord, WorkspaceRecord, PreviewTargetRecord, PreviewUrl } from '@/db/types';
import { getSupervisor, type PreviewStatus, type PreviewProcessRecord } from './supervisor';
import { allocatePort, isPortListening } from './net';
import { previewName as buildPreviewName } from './preview-name';
import { readPreviewSettings } from './settings';
import { getProvider, tryGetProvider, listProviders, PreviewProviderError } from './providers';
import { beamdClose, setBeamdBinOverride } from './beamd/cli';
import { beamdConfigExists } from './beamd/config';
import {
  readWorktreeServices,
  primaryService,
  injectSiblingEnv,
  type WorktreeServiceConfig,
} from './services-config';

export class PreviewServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly hint?: string;
  constructor(code: string, message: string, status = 400, hint?: string) {
    super(message);
    this.name = 'PreviewServiceError';
    this.code = code;
    this.status = status;
    this.hint = hint;
  }
}

export interface PreviewState {
  executionId: string;
  service: string | null;
  /** Service names for a multi-service worktree (empty for single-service). */
  availableServices: string[];
  previewName: string;
  /** The stable port we assign + inject as PORT. */
  assignedPort: number | null;
  /** Live supervised-process state. */
  serverStatus: PreviewStatus;
  /** Effective listening port (may differ from assignedPort if app ignored PORT). */
  port: number | null;
  /** Human-readable note from the supervisor (no-port, etc.). */
  message: string | null;
  /** Loopback URL — present when the server is up. Used when the viewer is local. */
  localUrl: string | null;
  /** Whether this preview is pinned for eager bring-up. */
  pinned: boolean;
  /** The active remote provider (from settings). */
  activeRemoteProviderId: string;
  activeRemoteProviderLabel: string;
  /** Reachable remote URL — only populated by a `remote` resolve. */
  remoteUrl: string | null;
  /** Actionable remote-provider error (not configured, no route, …). */
  remoteError: { code: string; message: string; hint?: string } | null;
  /** Manual URLs pasted on the execution (BYO tunnel). */
  manualUrls: PreviewUrl[];
}

interface WorktreeContext {
  execution: ExecutionRecord;
  workspace: WorkspaceRecord;
  cwd: string;
  worktreeName: string;
}

/** Resolve the execution + workspace + on-disk cwd, or throw a clean error. */
function loadContext(executionId: string): WorktreeContext {
  const execution = getExecution(executionId);
  if (!execution) throw new PreviewServiceError('not_found', 'Execution not found.', 404);
  const workspace = getWorkspace(execution.workspaceId);
  if (!workspace) throw new PreviewServiceError('not_found', 'Workspace not found.', 404);

  // Preview the worktree if one exists; fall back to the workspace cwd
  // (non-git workspaces, or live-mode executions running in the checkout).
  const cwd = execution.worktreePath ?? workspace.cwd;
  const worktreeName = execution.worktreePath
    ? path.basename(execution.worktreePath)
    : workspace.slug;
  return { execution, workspace, cwd, worktreeName };
}

/**
 * Load-or-create the desired-state record for (execution, service). Assigns
 * a stable port + DNS name on first creation. The port is allocated once
 * and reused on every restart → the URL stays stable.
 */
async function getOrCreateTarget(
  ctx: WorktreeContext,
  service: string | null,
  opts: { startCommand?: string | null } = {},
): Promise<PreviewTargetRecord> {
  let target = getPreviewTarget(ctx.execution.id, service);
  if (target) {
    const patch: Record<string, unknown> = {};
    // Backfill a port for legacy/partial rows.
    if (target.port == null) patch.port = await allocatePort();
    // Keep the per-service command in sync with the worktree config.
    if (opts.startCommand !== undefined && opts.startCommand !== target.startCommand) {
      patch.startCommand = opts.startCommand;
    }
    if (Object.keys(patch).length > 0) target = updatePreviewTarget(target.id, patch) ?? target;
  } else {
    const port = await allocatePort();
    try {
      target = createPreviewTarget({
        executionId: ctx.execution.id,
        service,
        previewName: buildPreviewName(ctx.worktreeName, service),
        port,
        // null → fall back to workspace.previewCommand at start time (single-service).
        startCommand: opts.startCommand ?? null,
        pinned: false,
      });
    } catch (err) {
      // Lost a create race against a concurrent resolve — the unique index
      // on (executionId, service) rejected us. Re-read the winner's row
      // instead of surfacing a raw 500 (H1).
      if (!isUniqueConstraintError(err)) throw err;
      target = getPreviewTarget(ctx.execution.id, service);
      if (!target) throw err;
      if (opts.startCommand !== undefined && opts.startCommand !== target.startCommand) {
        target = updatePreviewTarget(target.id, { startCommand: opts.startCommand }) ?? target;
      }
    }
  }
  return ensureFreeStablePort(target);
}

/** SQLite unique/PK constraint violation, surfaced by better-sqlite3. */
function isUniqueConstraintError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT');
}

/**
 * Self-heal a stale stable port (H2). The "allocate once, reuse forever"
 * model breaks if some *other* process has since grabbed the port: a
 * cold-start would crash-loop, or — worse — `confirmListening` would latch
 * onto the foreign process and serve the wrong app. So before we use it,
 * if the port is occupied by something that isn't our own supervised server,
 * reallocate and persist. The URL changes, which beats a permanent wedge.
 */
async function ensureFreeStablePort(target: PreviewTargetRecord): Promise<PreviewTargetRecord> {
  if (target.port == null) return target;
  // Our own running server legitimately holds the port — leave it.
  if (getSupervisor().isListening(target.id)) return target;
  if (!(await isPortListening(target.port))) return target;
  const fresh = await allocatePort();
  return updatePreviewTarget(target.id, { port: fresh }) ?? target;
}

/** Does the execution have a manual preview URL for this service? */
function executionHasManualUrl(execution: ExecutionRecord, service: string | null): boolean {
  const urls = execution.previewUrls ?? [];
  return urls.some((u) => (u.service ?? null) === service && !!u.url?.trim());
}

/** The dev command for a target — its override, else the workspace default. */
function resolveStartCommand(target: PreviewTargetRecord, ws: WorkspaceRecord): string | null {
  const cmd = (target.startCommand ?? ws.previewCommand ?? '').trim();
  return cmd || null;
}

/**
 * Ensure the supervised dev server is up and listening. Idempotent: a
 * running server returns immediately; a down one is cold-started from the
 * persisted start command and confirmed-listening.
 */
async function ensureServerListening(
  ctx: WorktreeContext,
  target: PreviewTargetRecord,
  extraEnv?: Record<string, string>,
): Promise<PreviewProcessRecord> {
  const sup = getSupervisor();
  const current = sup.status(target.id);
  if (current && (current.status === 'running' || current.status === 'starting')) {
    if (current.status === 'starting') {
      return (await sup.awaitListening(target.id)) ?? current;
    }
    return current;
  }

  const command = resolveStartCommand(target, ctx.workspace);
  if (!command) {
    throw new PreviewServiceError(
      'no_command',
      'No preview command set for this worktree.',
      400,
      'Set a preview command in workspace settings.',
    );
  }
  if (target.port == null) {
    throw new PreviewServiceError('no_port', 'No port assigned for this preview.', 500);
  }

  await sup.start({ key: target.id, command, cwd: ctx.cwd, port: target.port, env: extraEnv });
  const settled = await sup.awaitListening(target.id);
  return settled ?? sup.status(target.id)!;
}

function activeRemoteProvider() {
  const settings = readPreviewSettings();
  const id = settings.activeProvider;
  if (id === 'localhost') return { id, label: 'Localhost', provider: null };
  const provider = tryGetProvider(id) ?? null;
  return { id, label: provider?.label ?? id, provider };
}

/** Cheap snapshot — no bring-up, no side effects beyond reading. */
export function getPreviewState(executionId: string, service: string | null = null): PreviewState {
  const ctx = loadContext(executionId);
  // For a multi-service worktree, a null request resolves to the primary.
  const services = readWorktreeServices(ctx.cwd);
  const availableServices = services?.map((s) => s.name) ?? [];
  const effectiveService = service ?? (services ? primaryService(services).name : null);

  const target = getPreviewTarget(executionId, effectiveService) ?? null;
  const remote = activeRemoteProvider();
  const sup = getSupervisor();
  const rec = target ? sup.status(target.id) : null;

  // Viewing keeps the preview warm: bump lastViewedAt while it's live so the
  // idle-evict sweep doesn't reap a preview out from under an active viewer
  // who hasn't re-`resolve`d in a while (L2). The pane polls this every few
  // seconds, so it's an accurate "still watching" signal.
  if (target && (rec?.status === 'running' || rec?.status === 'starting')) {
    touchPreviewTarget(target.id);
  }

  const serverStatus: PreviewStatus = rec?.status ?? 'idle';
  const port = rec?.port ?? null;
  return {
    executionId,
    service: effectiveService,
    availableServices,
    previewName: target?.previewName ?? buildPreviewName(ctx.worktreeName, effectiveService),
    assignedPort: target?.port ?? null,
    serverStatus,
    port,
    message: rec?.message ?? null,
    localUrl: serverStatus === 'running' && port ? `http://localhost:${port}` : null,
    pinned: target?.pinned ?? false,
    activeRemoteProviderId: remote.id,
    activeRemoteProviderLabel: remote.label,
    remoteUrl: null,
    remoteError: null,
    manualUrls: ctx.execution.previewUrls ?? [],
  };
}

/**
 * Bring a preview up and return a reachable URL.
 *
 *   - `remote: false` → ensure the server, return the loopback `localUrl`.
 *   - `remote: true`  → route through the active remote provider. If that
 *     provider manages the local server (beamd), ensure + confirm it first;
 *     then resolve the URL. Provider errors come back as `remoteError`, not
 *     a thrown 500 — they're actionable states in the pane.
 */
export async function resolvePreview(
  executionId: string,
  opts: { service?: string | null; remote?: boolean } = {},
): Promise<PreviewState> {
  const remote = opts.remote ?? false;
  const ctx = loadContext(executionId);

  // Multi-service worktree (§10): resolve all services, inject sibling URLs,
  // and return the requested (or primary) service's state.
  const services = readWorktreeServices(ctx.cwd);
  if (services) {
    return resolveMultiService(ctx, services, opts.service ?? null, remote);
  }

  const service = opts.service ?? null;
  const target = await getOrCreateTarget(ctx, service);
  touchPreviewTarget(target.id);

  const remoteInfo = activeRemoteProvider();
  // A manual URL pasted on the execution takes precedence for remote viewers
  // — "paste a URL → the pane loads it; clear it → revert to the active
  // provider" (§6). Routes through the ManualProvider regardless of which
  // remote provider is active.
  const hasManualUrl = remote && executionHasManualUrl(ctx.execution, service);
  const provider = !remote
    ? getProvider('localhost')
    : hasManualUrl
      ? getProvider('manual')
      : remoteInfo.provider;

  // Remote requested but the active provider is "localhost" (local-only) or
  // an unknown/unregistered plugin id. No bring-up — a local URL is useless
  // to a remote viewer; surface the actionable state instead.
  if (remote && !provider) {
    return snapshotFromRecord(
      ctx, target, getSupervisor().status(target.id), remoteInfo, null,
      remoteInfo.id === 'localhost'
        ? { code: 'no_remote_provider', message: 'No remote provider is configured.', hint: 'Choose a remote provider (e.g. Beam) in preview settings.' }
        : { code: 'unknown_provider', message: `Remote provider "${remoteInfo.id}" is not available.` },
    );
  }

  const needsServer = provider!.managesLocalServer ?? true;
  let serverRec: PreviewProcessRecord | null = null;
  if (needsServer) {
    serverRec = await ensureServerListening(ctx, target);
    if (serverRec.status !== 'running' || serverRec.port == null) {
      // Server didn't come up (crashed / no port) — surface that, no URL.
      return snapshotFromRecord(ctx, target, serverRec, remoteInfo, null, serverRec.status === 'crashed'
        ? { code: 'server_crashed', message: serverRec.message ?? 'The dev server crashed on startup.' }
        : { code: 'no_port', message: serverRec.message ?? 'The dev server is running but no port was detected.' });
    }
  }

  const effectivePort = serverRec?.port ?? target.port ?? 0;
  const providerCtx = {
    worktreeName: ctx.worktreeName,
    service,
    port: effectivePort,
    workspaceId: ctx.workspace.id,
    executionId,
    previewName: target.previewName,
  };

  // For beamd, honor a configured binary path before we shell out.
  if (provider!.id === 'beamd') setBeamdBinOverride(readPreviewSettings().beamdBinPath);

  try {
    const resolved = await provider!.resolve(providerCtx);
    const url = resolved.url;
    return snapshotFromRecord(
      ctx, target, serverRec, remoteInfo,
      remote ? url : null,
      null,
      // local resolve: the provider's URL is the localUrl. remote resolve:
      // leave localUrl computed from the record (server is up locally too).
      remote ? undefined : url,
    );
  } catch (err) {
    if (err instanceof PreviewProviderError) {
      return snapshotFromRecord(ctx, target, serverRec, remoteInfo, null, {
        code: err.code,
        message: err.message,
        hint: err.hint,
      });
    }
    throw err;
  }
}

/**
 * Multi-service resolve (§10). Resolves every service's URL for the current
 * mode first, then starts each child with its sibling URLs injected as env —
 * so a web app opened from a phone talks to the API's public URL, not
 * `localhost`. Returns the requested (or primary) service's state.
 */
async function resolveMultiService(
  ctx: WorktreeContext,
  services: WorktreeServiceConfig[],
  requestedName: string | null,
  remote: boolean,
): Promise<PreviewState> {
  const remoteInfo = activeRemoteProvider();
  const requested = requestedName
    ? (services.find((s) => s.name === requestedName) ?? primaryService(services))
    : primaryService(services);
  const canServe = !remote || !!remoteInfo.provider;

  // 1. Ensure a target per service (stable port + DNS name + command).
  //    Sequential — each does a quick `allocatePort`, and running them in
  //    parallel risks two services grabbing the same `:0` port.
  const targets = new Map<string, PreviewTargetRecord>();
  for (const svc of services) {
    targets.set(svc.name, await getOrCreateTarget(ctx, svc.name, { startCommand: svc.command }));
  }
  touchPreviewTarget(targets.get(requested.name)!.id);

  // 2. Resolve each service's URL for this mode (in parallel). Local uses the
  //    assigned port directly; remote opens the tunnel (verified to tolerate a
  //    not-yet-live port). Collected for sibling injection + the response.
  const urls = new Map<string, string>();
  const errors = new Map<string, { code: string; message: string; hint?: string }>();
  if (remote && remoteInfo.id === 'beamd') setBeamdBinOverride(readPreviewSettings().beamdBinPath);
  await Promise.all(services.map(async (svc) => {
    const t = targets.get(svc.name)!;
    if (!remote) {
      urls.set(svc.name, `http://localhost:${t.port}`);
      return;
    }
    if (!remoteInfo.provider) {
      errors.set(svc.name, {
        code: 'no_remote_provider',
        message: 'No remote provider is configured.',
        hint: 'Choose a remote provider (e.g. Beam) in preview settings.',
      });
      return;
    }
    try {
      const resolved = await remoteInfo.provider.resolve({
        worktreeName: ctx.worktreeName,
        service: svc.name,
        port: t.port ?? 0,
        workspaceId: ctx.workspace.id,
        executionId: ctx.execution.id,
        previewName: t.previewName,
      });
      urls.set(svc.name, resolved.url);
    } catch (err) {
      if (err instanceof PreviewProviderError) {
        errors.set(svc.name, { code: err.code, message: err.message, hint: err.hint });
      } else {
        throw err;
      }
    }
  }));

  // 3. Start each service with its sibling URLs injected as env, then confirm
  //    it's listening — in parallel, so total latency is the slowest single
  //    service, not the sum. Skipped entirely when there's no way to reach a
  //    remote viewer (no provider). A sibling that fails to start is recorded
  //    as null rather than killing the requested service's view.
  const records = new Map<string, PreviewProcessRecord | null>();
  if (canServe) {
    await Promise.all(services.map(async (svc) => {
      const t = targets.get(svc.name)!;
      try {
        records.set(svc.name, await ensureServerListening(ctx, t, injectSiblingEnv(svc.env, urls)));
      } catch (err) {
        if (err instanceof PreviewServiceError && svc.name !== requested.name) {
          records.set(svc.name, null);
        } else {
          throw err;
        }
      }
    }));
  }

  // 4. Build the requested service's state.
  const t = targets.get(requested.name)!;
  const rec = records.get(requested.name) ?? null;
  return {
    ...snapshotFromRecord(
      ctx, t, rec, remoteInfo,
      remote ? (urls.get(requested.name) ?? null) : null,
      remote ? (errors.get(requested.name) ?? null) : null,
    ),
    service: requested.name,
    availableServices: services.map((s) => s.name),
  };
}

function snapshotFromRecord(
  ctx: WorktreeContext,
  target: PreviewTargetRecord,
  rec: PreviewProcessRecord | null,
  remoteInfo: { id: string; label: string },
  remoteUrl: string | null,
  remoteError: { code: string; message: string; hint?: string } | null,
  localUrlOverride?: string | null,
): PreviewState {
  const serverStatus: PreviewStatus = rec?.status ?? 'idle';
  const port = rec?.port ?? null;
  const localUrl = localUrlOverride !== undefined
    ? localUrlOverride
    : (serverStatus === 'running' && port ? `http://localhost:${port}` : null);
  return {
    executionId: ctx.execution.id,
    service: target.service,
    availableServices: [],
    previewName: target.previewName,
    assignedPort: target.port,
    serverStatus,
    port,
    message: rec?.message ?? null,
    localUrl,
    pinned: target.pinned,
    activeRemoteProviderId: remoteInfo.id,
    activeRemoteProviderLabel: remoteInfo.label,
    remoteUrl,
    remoteError,
    manualUrls: ctx.execution.previewUrls ?? [],
  };
}

/**
 * Stop a preview: tear down the supervised server(s) and close the remote
 * tunnel(s). A null `service` stops every service of the worktree
 * (multi-service); a named one stops just that service. The desired-state
 * rows survive, so names/URLs stay reserved for a later cold-start.
 */
export async function stopPreview(executionId: string, service: string | null = null): Promise<void> {
  const sup = getSupervisor();
  const targets = service === null
    ? listPreviewTargetsForExecution(executionId)
    : [getPreviewTarget(executionId, service)].filter((t): t is PreviewTargetRecord => !!t);
  for (const t of targets) {
    await sup.stop(t.id);
    await closeRemoteTunnel(t.previewName);
  }
}

/**
 * Close a dynamic remote tunnel by name (beamd). Best-effort + idempotent.
 * Attempts the close whenever beamd is configured — not just when it's the
 * *active* provider — so a tunnel opened under beamd is still torn down if
 * the user switched the active provider away before hitting Stop (L6).
 */
async function closeRemoteTunnel(previewName: string): Promise<void> {
  if (!beamdConfigExists()) return;
  try {
    setBeamdBinOverride(readPreviewSettings().beamdBinPath);
    await beamdClose(previewName);
  } catch {
    // Idempotent — a dangling tunnel self-expires.
  }
}

export function previewLogs(
  executionId: string,
  service: string | null,
  cursor: number,
): { cursor: number; lines: ReturnType<ReturnType<typeof getSupervisor>['logsSince']> } {
  const target = getPreviewTarget(executionId, service);
  if (!target) return { cursor, lines: [] };
  const lines = getSupervisor().logsSince(target.id, cursor);
  const next = lines.length > 0 ? lines[lines.length - 1].seq : cursor;
  return { cursor: next, lines };
}

/** Set/clear the manual preview URLs on an execution (§6). */
export function setPreviewUrls(executionId: string, urls: PreviewUrl[]): PreviewUrl[] {
  const updated = setExecutionPreviewUrls(executionId, urls);
  if (!updated) throw new PreviewServiceError('not_found', 'Execution not found.', 404);
  return updated.previewUrls ?? [];
}

/** Toggle the pinned flag (eager bring-up / restore-set membership). */
export function setPreviewPinned(executionId: string, service: string | null, pinned: boolean): void {
  const target = getPreviewTarget(executionId, service);
  if (target) updatePreviewTarget(target.id, { pinned });
}

/**
 * Restore-set: bring up a workspace's pinned previews at once (server +
 * remote tunnel for whatever the active provider is). Reads from the §2
 * desired-state. Returns a per-target outcome summary.
 */
export async function restoreWorkspacePreviews(workspaceId: string): Promise<
  Array<{ executionId: string; service: string | null; ok: boolean; error?: string }>
> {
  const targets = listPinnedPreviewTargetsForWorkspace(workspaceId);
  const remote = readPreviewSettings().activeProvider !== 'localhost';
  const results: Array<{ executionId: string; service: string | null; ok: boolean; error?: string }> = [];
  for (const t of targets) {
    try {
      const state = await resolvePreview(t.executionId, { service: t.service, remote });
      const ok = remote ? !!state.remoteUrl : !!state.localUrl;
      results.push({ executionId: t.executionId, service: t.service, ok, error: state.remoteError?.message });
    } catch (err) {
      results.push({
        executionId: t.executionId,
        service: t.service,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

// ─── Idle-evict ───────────────────────────────────────────────
// Symmetric teardown: after N idle minutes, stop the server AND close the
// tunnel. The name/URL stays reserved (the preview_targets row persists), so
// the next view cold-starts the same URL. Keeps an overnight queue of
// finished tasks from melting the host.

const DEFAULT_IDLE_MINUTES = 30;

export async function idleEvictSweep(idleMinutes = DEFAULT_IDLE_MINUTES): Promise<number> {
  const sup = getSupervisor();
  const cutoff = Date.now() - idleMinutes * 60_000;
  let evicted = 0;
  // Process keys ARE preview-target ids, so map the supervisor's live set
  // straight back to rows — no full-table scan.
  for (const key of sup.liveKeys()) {
    const target = getPreviewTargetById(key);
    if (!target || target.pinned) continue; // pinned previews are kept warm intentionally
    const lastViewed = target.lastViewedAt ? Date.parse(target.lastViewedAt) : Date.parse(target.updatedAt);
    if (Number.isFinite(lastViewed) && lastViewed < cutoff) {
      await sup.stop(key);
      await closeRemoteTunnel(target.previewName);
      evicted++;
    }
  }
  return evicted;
}

let idleLoopStarted = false;
/** Start the idle-evict loop once. Wired from instrumentation at boot. */
export function startIdleEvictLoop(idleMinutes = DEFAULT_IDLE_MINUTES): void {
  if (idleLoopStarted) return;
  idleLoopStarted = true;
  const interval = setInterval(() => {
    idleEvictSweep(idleMinutes).catch((err) => console.warn('[preview] idle-evict sweep failed:', err));
  }, 60_000);
  interval.unref?.();
}

/** Surface the registered providers for the settings picker. */
export function listPreviewProviders() {
  return listProviders().map((p) => ({ id: p.id, label: p.label, kind: p.kind }));
}

/** All preview targets for an execution (for multi-service surfaces). */
export function listExecutionPreviewTargets(executionId: string): PreviewTargetRecord[] {
  return listPreviewTargetsForExecution(executionId);
}
