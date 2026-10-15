/**
 * Composio sessions for agent tools (docs/connector-service-spec.md §9).
 *
 * A session is a server-side execution handle with its own restrictions. Ri creates one per
 * (source, remote user, exact account, allowed action set, catalog revision), on the first call
 * that needs it, and shares it between callers whose grants for that account are identical: the
 * harness never holds a session, and Ri checks the live caller before every call, so a chat adds
 * nothing to the vendor-side boundary.
 *
 * A session is published only after its readback matches every restriction and its tool list is
 * exactly the allowed slugs. Anything else is deleted and the call fails closed. The registry of
 * live sessions is a file under the integrations dir, so every process on the home shares it and
 * a restart can clean up what an earlier process left behind.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';
import { canonicalStringify } from '@integrations/engine';
import { processState } from '@/lib/process-state';
import { getIntegrationsDir } from '../../storage';
import { CATALOG_REVISION } from './catalog';
import { isComposioApiError, type ComposioClient, type RemoteSession, type RemoteTool } from './client';

export const SESSIONS_FILE = 'managed-sessions.json';
/** Reads may reuse a validated tool listing this long. Writes always refresh it. */
export const READ_REVALIDATE_MS = 60_000;

export interface SessionTarget {
  sourceId: string;
  remoteUserId: string;
  remoteAccountId: string;
  toolkitSlug: string;
  /** The reviewed slugs this session may expose, nothing more. */
  slugs: string[];
}

export interface ValidatedTool {
  slug: string;
  version: string;
  schemaHash: string;
  inputParameters: Record<string, unknown>;
}

export interface LiveSession {
  sessionId: string;
  tools: Map<string, ValidatedTool>;
  validatedAt: number;
}

const recordSchema = z.object({
  key: z.string(), sessionId: z.string(), sourceId: z.string(), remoteAccountId: z.string(), createdAt: z.string(),
}).strict();
const documentSchema = z.object({
  version: z.literal(1),
  sessions: z.array(recordSchema),
  /** Sessions Ri no longer uses whose remote deletion hasn't succeeded yet. */
  orphans: z.array(z.object({ sessionId: z.string(), sourceId: z.string(), since: z.string() }).strict()),
}).strict();
type SessionDocument = z.infer<typeof documentSchema>;

export class SessionRestrictionError extends Error {
  constructor(readonly problems: string[]) {
    super(`Composio didn't apply Ri's restrictions to the session (${problems.slice(0, 3).join('; ')}). Ri won't use it.`);
    this.name = 'SessionRestrictionError';
  }
}

export function schemaHash(inputParameters: unknown): string {
  return createHash('sha256').update(canonicalStringify(inputParameters ?? {})).digest('hex').slice(0, 16);
}

export function sessionKey(target: SessionTarget): string {
  return createHash('sha256').update(JSON.stringify([
    target.sourceId, target.remoteUserId, target.remoteAccountId, target.toolkitSlug, [...target.slugs].sort(), CATALOG_REVISION,
  ])).digest('hex').slice(0, 32);
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);

/** Every way a session readback can differ from what Ri asked for. Empty means it matches. */
export function sessionProblems(remote: RemoteSession, target: SessionTarget): string[] {
  const problems: string[] = [];
  const config = remote.config;
  if (config.user_id !== target.remoteUserId) problems.push('it belongs to another user');
  const toolkits = config.toolkits && 'enabled' in config.toolkits ? config.toolkits.enabled : undefined;
  if (!toolkits || !sameSet(toolkits, [target.toolkitSlug])) problems.push('its toolkit allowlist differs');
  if (config.toolkits && 'require_approval' in config.toolkits && config.toolkits.require_approval?.length) problems.push('it pauses tools for vendor approval');
  const toolPolicy = config.tools?.[target.toolkitSlug] as { enabled?: unknown } | undefined;
  if (!config.tools || Object.keys(config.tools).length !== 1 || !Array.isArray(toolPolicy?.enabled) || !sameSet(toolPolicy.enabled as string[], target.slugs)) {
    problems.push('its tool allowlist differs');
  }
  if (config.tags !== undefined) problems.push('it filters by tags');
  const accounts = config.connected_accounts;
  if (!accounts || Object.keys(accounts).length !== 1 || !sameSet(accounts[target.toolkitSlug] ?? [], [target.remoteAccountId])) problems.push('it is not pinned to the one account');
  if (config.instant !== false) problems.push('instant tools are on');
  if (config.manage_connections?.enabled !== false) problems.push('connection management is on');
  if (config.manage_connections?.enable_connection_removal !== false) problems.push('connection removal is on');
  if (config.manage_connections?.enable_wait_for_connections === true) problems.push('connection waiting is on');
  if (config.workbench?.enable !== false) problems.push('the workbench is on');
  if (config.workbench?.proxy_execution_enabled === true) problems.push('workbench proxy execution is on');
  if (config.proxy_execute && config.proxy_execute.enable !== false) problems.push('proxy execution is on');
  if (config.multi_account?.enable === true) problems.push('multi-account mode is on');
  const preload = config.preload?.tools;
  if (!Array.isArray(preload) || !sameSet(preload, target.slugs)) problems.push('its preloaded tools differ');
  if (config.search?.enable !== false) problems.push('tool search is on');
  if (config.execute?.enable_multi_execute !== false) problems.push('multi-execute is on');
  const helpers = (remote.tool_router_tools ?? []).filter(slug => !target.slugs.includes(slug));
  if (helpers.length) problems.push(`it exposes ${helpers.join(', ')}`);
  return problems;
}

/** The session's tools, validated to be exactly the allowed slugs with recorded versions. */
export function validatedTools(tools: RemoteTool[], target: SessionTarget): Map<string, ValidatedTool> {
  const problems: string[] = [];
  const slugs = tools.map(tool => tool.slug);
  const unexpected = slugs.filter(slug => !target.slugs.includes(slug) || slug.startsWith('COMPOSIO_'));
  if (unexpected.length) problems.push(`it lists ${unexpected.join(', ')}`);
  const missing = target.slugs.filter(slug => !slugs.includes(slug));
  if (missing.length) problems.push(`it lacks ${missing.join(', ')}`);
  if (new Set(slugs).size !== slugs.length) problems.push('it lists a tool twice');
  const out = new Map<string, ValidatedTool>();
  for (const tool of tools) {
    if (tool.toolkitSlug && tool.toolkitSlug !== target.toolkitSlug) problems.push(`${tool.slug} is from another toolkit`);
    if (!tool.version) problems.push(`${tool.slug} has no version`);
    out.set(tool.slug, { slug: tool.slug, version: tool.version ?? '', schemaHash: schemaHash(tool.inputParameters), inputParameters: tool.inputParameters });
  }
  if (problems.length) throw new SessionRestrictionError(problems);
  return out;
}

// ─── The shared registry ─────────────────────────────────────────────────────

function registryPath(dir: string): string {
  return path.join(dir, SESSIONS_FILE);
}

function readRegistry(dir: string): SessionDocument {
  try {
    const parsed = documentSchema.safeParse(JSON.parse(fs.readFileSync(registryPath(dir), 'utf8')));
    if (parsed.success) return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { /* unreadable: start over below */ }
  }
  // An unreadable registry only holds handles. Starting empty loses nothing Ri relies on for
  // safety: a lost entry is a vendor session nobody uses, cleaned up when found.
  return { version: 1, sessions: [], orphans: [] };
}

function updateRegistry<T>(dir: string, change: (document: SessionDocument) => T): T {
  const file = registryPath(dir);
  return withFileLock(file, () => {
    const document = readRegistry(dir);
    const result = change(document);
    atomicWriteFile(file, `${JSON.stringify(document, null, 2)}\n`);
    return result;
  });
}

/** Validated sessions this process has checked, keyed by session key. */
const cache = processState('integrations.managed-sessions', () => ({
  live: new Map<string, LiveSession>(),
  /** One construction at a time per key in this process. */
  building: new Map<string, Promise<LiveSession>>(),
}));

export interface SessionManagerDeps {
  client: ComposioClient;
  dir?: string;
  now?: () => number;
}

/**
 * Find or construct the session for a target. `fresh` forces a readback and tool listing even
 * when this process validated the session recently (every write passes it).
 */
export async function acquireSession(target: SessionTarget, deps: SessionManagerDeps, opts: { fresh: boolean }): Promise<LiveSession> {
  if (target.slugs.length === 0) throw new SessionRestrictionError(['no actions are allowed']);
  const dir = deps.dir ?? getIntegrationsDir();
  const now = deps.now ?? Date.now;
  const key = sessionKey(target);
  const cached = cache.live.get(key);
  if (cached && !opts.fresh && now() - cached.validatedAt < READ_REVALIDATE_MS) return cached;
  const inFlight = cache.building.get(key);
  if (inFlight) return inFlight;
  const work = (async () => {
    // Retire sessions for this account built for another action set or catalog revision.
    const stale = updateRegistry(dir, document => {
      const old = document.sessions.filter(record => record.sourceId === target.sourceId && record.remoteAccountId === target.remoteAccountId && record.key !== key);
      document.sessions = document.sessions.filter(record => !old.includes(record));
      document.orphans.push(...old.map(record => ({ sessionId: record.sessionId, sourceId: record.sourceId, since: new Date(now()).toISOString() })));
      return old;
    });
    if (stale.length) await sweepOrphans(target.sourceId, deps);
    const recorded = readRegistry(dir).sessions.find(record => record.key === key);
    if (recorded) {
      try {
        return await validateExisting(recorded.sessionId, target, deps, key);
      } catch (error) {
        // Gone, or no longer matching: retire it and build a fresh one.
        await retire(dir, key, recorded.sessionId, target.sourceId, deps, now);
        if (!(error instanceof SessionRestrictionError) && !(isComposioApiError(error) && error.kind === 'not_found')) throw error;
      }
    }
    return construct(target, deps, key, dir, now);
  })();
  cache.building.set(key, work);
  try {
    return await work;
  } finally {
    cache.building.delete(key);
  }
}

async function validateExisting(sessionId: string, target: SessionTarget, deps: SessionManagerDeps, key: string): Promise<LiveSession> {
  const remote = await deps.client.getSession(sessionId);
  const problems = sessionProblems(remote, target);
  if (problems.length) throw new SessionRestrictionError(problems);
  const tools = validatedTools(await deps.client.listSessionTools(sessionId), target);
  const live = { sessionId, tools, validatedAt: (deps.now ?? Date.now)() };
  cache.live.set(key, live);
  return live;
}

async function construct(target: SessionTarget, deps: SessionManagerDeps, key: string, dir: string, now: () => number): Promise<LiveSession> {
  const remote = await deps.client.createSession({
    userId: target.remoteUserId, toolkitSlug: target.toolkitSlug, toolSlugs: target.slugs, connectedAccountId: target.remoteAccountId,
  });
  // Record the handle first, so a crash below still leaves it findable for cleanup.
  updateRegistry(dir, document => {
    document.orphans.push({ sessionId: remote.session_id, sourceId: target.sourceId, since: new Date(now()).toISOString() });
  });
  let live: LiveSession;
  try {
    const problems = sessionProblems(remote, target);
    if (problems.length) throw new SessionRestrictionError(problems);
    // The create response is checked, then the stored config is read back on its own.
    const stored = await deps.client.getSession(remote.session_id);
    const storedProblems = sessionProblems(stored, target);
    if (storedProblems.length) throw new SessionRestrictionError(storedProblems);
    live = { sessionId: remote.session_id, tools: validatedTools(await deps.client.listSessionTools(remote.session_id), target), validatedAt: now() };
  } catch (error) {
    await sweepOrphans(target.sourceId, deps);
    throw error;
  }
  // Publish. Another process may have published the same key meanwhile: keep the first.
  const winner = updateRegistry(dir, document => {
    document.orphans = document.orphans.filter(orphan => orphan.sessionId !== remote.session_id);
    const existing = document.sessions.find(record => record.key === key);
    if (existing) {
      document.orphans.push({ sessionId: remote.session_id, sourceId: target.sourceId, since: new Date(now()).toISOString() });
      return existing.sessionId;
    }
    document.sessions.push({ key, sessionId: remote.session_id, sourceId: target.sourceId, remoteAccountId: target.remoteAccountId, createdAt: new Date(now()).toISOString() });
    return remote.session_id;
  });
  if (winner !== remote.session_id) {
    await sweepOrphans(target.sourceId, deps);
    return validateExisting(winner, target, deps, key);
  }
  cache.live.set(key, live);
  return live;
}

async function retire(dir: string, key: string, sessionId: string, sourceId: string, deps: SessionManagerDeps, now: () => number): Promise<void> {
  cache.live.delete(key);
  updateRegistry(dir, document => {
    document.sessions = document.sessions.filter(record => record.sessionId !== sessionId);
    if (!document.orphans.some(orphan => orphan.sessionId === sessionId)) document.orphans.push({ sessionId, sourceId, since: new Date(now()).toISOString() });
  });
  await sweepOrphans(sourceId, deps);
}

/** Delete sessions Ri no longer uses. A failed deletion stays listed for the next sweep. */
export async function sweepOrphans(sourceId: string, deps: SessionManagerDeps): Promise<void> {
  const dir = deps.dir ?? getIntegrationsDir();
  const orphans = readRegistry(dir).orphans.filter(orphan => orphan.sourceId === sourceId);
  for (const orphan of orphans) {
    try {
      await deps.client.deleteSession(orphan.sessionId);
    } catch (error) {
      if (!(isComposioApiError(error) && error.kind === 'not_found')) continue;
    }
    updateRegistry(dir, document => {
      document.orphans = document.orphans.filter(candidate => candidate.sessionId !== orphan.sessionId);
    });
  }
}

/**
 * Stop using every session for a source, or for one account of it, now. Local use ends before
 * any network call. Remote deletion is attempted when a client is given, and retried later.
 */
export async function invalidateSessions(filter: { sourceId: string; remoteAccountId?: string }, deps?: SessionManagerDeps): Promise<void> {
  const dir = deps?.dir ?? getIntegrationsDir();
  const matches = (record: { sourceId: string; remoteAccountId?: string }) => record.sourceId === filter.sourceId
    && (!filter.remoteAccountId || record.remoteAccountId === filter.remoteAccountId);
  const removed = updateRegistry(dir, document => {
    const out = document.sessions.filter(matches);
    document.sessions = document.sessions.filter(record => !matches(record));
    document.orphans.push(...out.map(record => ({ sessionId: record.sessionId, sourceId: record.sourceId, since: new Date().toISOString() })));
    return out;
  });
  for (const record of removed) cache.live.delete(record.key);
  // A cached entry from a record another process already removed is dropped too.
  for (const [key, live] of cache.live) if (removed.some(record => record.sessionId === live.sessionId)) cache.live.delete(key);
  if (deps) await sweepOrphans(filter.sourceId, deps);
}

/** Drop this process's cached validation, so the next call reads the session back again. */
export function forgetValidatedSessions(): void {
  cache.live.clear();
}
