/**
 * Domain operations for managed connection sources (docs/connector-service-spec.md §§2, 6, 8).
 * The tRPC router, the callback route and the chat's connection cards all go through here.
 *
 *  - Sources: add a Composio project once, rotate its key, turn it off, remove it, prefer it.
 *  - Methods: which way a new connection for an application is made, and explicit overrides.
 *  - Accounts: connect through a Connect Link (callback or polling), import an account the bound
 *    remote user already has, reconnect, disconnect from Ri, revoke the remote account.
 */
import type { ConnectionStore } from '@integrations/engine';
import { processState } from '@/lib/process-state';
import type { ManagedSourceStatus } from './managed-provider';
import { getLocalBaseUrl, getRemoteBaseUrl } from '@/lib/auth/bootstrap';
import { revokeApprovalsForConnections } from '../approval';
import { pageOrigin, safeReturnPath } from '../oauth-return';
import { getIntegrationSecretBox } from '../storage';
import { APPLICATIONS, isApplicationId, managedToolkitId } from './applications';
import {
  createAttempt, findPendingAttempt, getAttempt, newAttemptId, settleAttempt, type ConnectAttempt,
} from './attempts';
import { ensureAuthConfig, listOwnAccounts, readVerifiedIdentity, revokeRemoteAccount, toolkitSlugFor, verifyAttemptAccount, type RemoteCleanup } from './composio/adapter';
import { isComposioApiError, type RemoteAccount } from './composio/client';
import { invalidateSessions } from './composio/sessions';
import { listManagedConnections, managedConfig, managedConnectionId, saveManagedConnection } from './managed-connections';
import { selectConnectionMethod, overrideForChoice, type MethodSelection, type SourceHealth } from './method-selection';
import { newRemoteUserId, newSourceId, readPreferences, updatePreferences } from './preferences';
import { deleteSourceCredential, saveSourceCredential, sourceCredentialRevision } from './source-credentials';
import { composioClient, findSource, openSource, sourceUsable, type OpenSource } from './source-runtime';
import { isManagedMethod, type ApplicationId, type ApplicationMethod, type Capability, type SourceEntry } from './types';

export class SourceError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'conflict' | 'unavailable' | 'rejected', message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

/** What the service needs from the integration runtime. Injected in tests. */
export interface SourceServiceDeps {
  invalidateRuntime(): void;
  connectionStore(): ConnectionStore;
  ownerId(): string;
  managedSourceStatuses(): Promise<ManagedSourceStatus[]>;
  /** A working direct sign-in exists for the provider (a bundled, operator or saved OAuth app). */
  directConfigured(providerId: string): Promise<boolean>;
}

const depsState = processState('integrations.source-service-deps', () => ({ override: null as SourceServiceDeps | null }));

export function setSourceServiceDeps(next: SourceServiceDeps | null): void {
  depsState.override = next;
}

// Lazy: the runtime module is heavy, and pulling it at import would cycle through the provider.
export async function sourceServiceDeps(): Promise<SourceServiceDeps> {
  if (depsState.override) return depsState.override;
  const runtime = await import('../runtime');
  return {
    invalidateRuntime: runtime.invalidateIntegrationRuntime,
    connectionStore: runtime.getIntegrationConnectionStore,
    ownerId: runtime.getIntegrationOwnerId,
    managedSourceStatuses: runtime.getManagedSourceStatuses,
    directConfigured: async providerId => (await runtime.getProviderStatuses()).find(status => status.id === providerId)?.configured ?? false,
  };
}

async function invalidateRuntime(): Promise<void> {
  (await sourceServiceDeps()).invalidateRuntime();
}

async function connectionStore(): Promise<ConnectionStore> {
  return (await sourceServiceDeps()).connectionStore();
}

async function ownerId(): Promise<string> {
  return (await sourceServiceDeps()).ownerId();
}

const coordination = processState('integrations.managed-coordination', () => ({
  /** The tail of each account's queue of state changes (finish, cancel, disconnect, import). */
  accountTails: new Map<string, Promise<void>>(),
  /** A sign-in being started, so a second click or tab joins it instead of creating another. */
  starting: new Map<string, Promise<BeginManagedConnectResult>>(),
}));

/**
 * Run one change to a managed account's local state at a time. Completing a sign-in, cancelling
 * it, disconnecting and importing all read and then write the account row, with network calls in
 * between, so each takes the account's turn for its final check and write.
 */
async function withAccountTurn<T>(connectionId: string, run: () => Promise<T>): Promise<T> {
  const previous = coordination.accountTails.get(connectionId) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => turn);
  coordination.accountTails.set(connectionId, tail);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (coordination.accountTails.get(connectionId) === tail) coordination.accountTails.delete(connectionId);
  }
}

/** One start per key in flight: concurrent requests for the same sign-in share its result. */
async function startOnce(key: string, start: () => Promise<BeginManagedConnectResult>): Promise<BeginManagedConnectResult> {
  const inFlight = coordination.starting.get(key);
  if (inFlight) return inFlight;
  const work = start();
  coordination.starting.set(key, work);
  try {
    return await work;
  } finally {
    coordination.starting.delete(key);
  }
}

// ─── Sources ─────────────────────────────────────────────────────────────────

const KEY_PATTERN = /^[A-Za-z0-9_\-.]{8,300}$/;

function checkKeyShape(apiKey: string): string {
  const key = apiKey.trim();
  if (key.startsWith('uak_')) throw new SourceError('invalid', 'That is a Composio user API key. Ri needs a project API key, from your project\'s settings.');
  if (!KEY_PATTERN.test(key)) throw new SourceError('invalid', 'That doesn\'t look like a Composio project API key.');
  return key;
}

/** Check a key reaches a project Ri can work in, without saving anything. */
async function verifyKey(apiKey: string): Promise<{ project: { id: string; name?: string } | null }> {
  const client = composioClient(apiKey);
  try {
    const project = await client.projectInfo();
    // Auth configs are the first thing every connection needs: prove the key can read them.
    await client.listAuthConfigs('gmail');
    return { project };
  } catch (error) {
    if (isComposioApiError(error) && (error.kind === 'unauthorized' || error.kind === 'forbidden')) {
      throw new SourceError('rejected', error.kind === 'unauthorized'
        ? 'Composio didn\'t accept that key. Copy the project API key again and paste it here.'
        : 'That key can\'t manage auth configs. Use the project\'s default key, or a scoped key with auth configs, connected accounts, tools, session management and tool execution.');
    }
    if (isComposioApiError(error)) throw new SourceError('unavailable', `Composio couldn't be reached to check the key (${error.message}). Try again.`);
    throw error;
  }
}

export interface SourceView {
  id: string;
  kind: SourceEntry['kind'];
  label: string;
  enabled: boolean;
  preferred: boolean;
  hasKey: boolean;
  project?: { id: string; name?: string };
  health: { state: 'ok' | 'disabled' | 'no_key' | 'key_rejected' | 'unreachable' | 'cached' | 'unknown'; detail?: string };
  accounts: { applicationId: ApplicationId; count: number }[];
}

export interface SourcesOverview {
  preferences: { status: 'missing' | 'ok' | 'invalid' | 'unsupported'; error?: string; file?: string };
  preferredSourceId: string | null;
  sources: SourceView[];
  applicationMethods: Partial<Record<ApplicationId, ApplicationMethod>>;
  calendarUse: Record<string, boolean>;
}

export async function sourcesOverview(): Promise<SourcesOverview> {
  const read = readPreferences();
  const statuses = read.preferences.sources.length ? await (await sourceServiceDeps()).managedSourceStatuses().catch(() => []) : [];
  const connections = read.preferences.sources.length ? await listManagedConnections(await connectionStore(), { ownerId: await ownerId() }) : [];
  return {
    preferences: {
      status: read.status,
      ...(read.status === 'invalid' ? { error: read.error, file: read.file } : {}),
      ...(read.status === 'unsupported' ? { error: `Version ${String(read.version)} isn't supported by this version of Ri.`, file: read.file } : {}),
    },
    preferredSourceId: read.preferences.preferredSourceId ?? null,
    sources: read.preferences.sources.map(source => {
      const hasKey = Boolean(sourceCredentialRevision(source.id));
      const status = statuses.find(candidate => candidate.sourceId === source.id);
      const health: SourceView['health'] = !source.enabled ? { state: 'disabled' } : !hasKey ? { state: 'no_key' }
        : status ? { state: status.state, ...(status.detail ? { detail: status.detail } : {}) } : { state: 'unknown' };
      const mine = connections.filter(connection => managedConfig(connection)?.sourceId === source.id);
      return {
        id: source.id, kind: source.kind, label: source.label, enabled: source.enabled,
        preferred: read.preferences.preferredSourceId === source.id, hasKey,
        ...(source.project ? { project: source.project } : {}),
        health,
        accounts: (Object.keys(APPLICATIONS) as ApplicationId[]).map(applicationId => ({
          applicationId, count: mine.filter(connection => managedConfig(connection)?.applicationId === applicationId).length,
        })),
      };
    }),
    applicationMethods: read.preferences.applicationMethods,
    calendarUse: read.preferences.calendarUse,
  };
}

/**
 * Enable Composio for this home: check the key, give the source its own remote user, seal the
 * key, then record the source. The credential is saved before the entry, so an interrupted add
 * leaves at most an unused sealed key, never an entry that looks usable but can't execute.
 */
export async function addComposioSource(input: { apiKey: string; label?: string }): Promise<SourceView> {
  const apiKey = checkKeyShape(input.apiKey);
  const { project } = await verifyKey(apiKey);
  const read = readPreferences();
  if (read.status === 'invalid' || read.status === 'unsupported') {
    throw new SourceError('unavailable', `Connection preferences can't be read (${read.file}). Repair or move that file first.`);
  }
  if (project && read.preferences.sources.some(source => source.project?.id === project.id)) {
    throw new SourceError('conflict', 'This Composio project is already set up here. Use Update key on it instead.');
  }
  const id = newSourceId(read.preferences);
  await saveSourceCredential(id, { apiKey });
  const label = input.label?.trim() || (read.preferences.sources.length === 0 ? 'Composio' : project?.name ? `Composio (${project.name})` : 'Composio');
  try {
    updatePreferences(preferences => {
      preferences.sources.push({
        id, kind: 'composio', label: label.slice(0, 60), enabled: true, remoteUserId: newRemoteUserId(),
        createdAt: new Date().toISOString(), ...(project ? { project } : {}),
      });
      // The first managed source becomes the preference. Adding another never replaces it.
      if (!preferences.preferredSourceId) preferences.preferredSourceId = id;
    });
  } catch (error) {
    deleteSourceCredential(id);
    throw error;
  }
  await invalidateRuntime();
  const view = (await sourcesOverview()).sources.find(source => source.id === id);
  if (!view) throw new SourceError('unavailable', 'The source was saved but could not be read back.');
  return view;
}

/**
 * Replace a source's key. Its identity (and every account bound to it) carries over only when
 * the new key verifiably reaches the same project and every bound account. Otherwise the key
 * belongs to a different project, which is a new source.
 */
export async function rotateSourceKey(sourceId: string, newKey: string): Promise<SourceView> {
  const source = findSource(sourceId);
  if (!source) throw new SourceError('not_found', 'That source no longer exists.');
  const apiKey = checkKeyShape(newKey);
  const { project } = await verifyKey(apiKey);
  if (source.project && project && project.id !== source.project.id) {
    throw new SourceError('conflict', 'That key is for a different Composio project. Add it as a new source instead.');
  }
  const bound = await listManagedConnections(await connectionStore(), { ownerId: await ownerId(), sourceId });
  if (bound.length > 0) {
    const visible = await composioClient(apiKey).listConnectedAccounts({ userIds: [source.remoteUserId] })
      .catch(error => { throw new SourceError('unavailable', `Couldn't check the accounts with the new key (${error instanceof Error ? error.message : String(error)}).`); });
    const missing = bound.filter(connection => !visible.some(account => account.id === connection.accountId));
    if (missing.length > 0) throw new SourceError('conflict', `That key can't see ${missing.length === 1 ? 'an account' : `${missing.length} accounts`} connected through ${source.label}. It may be for a different project. Add it as a new source instead.`);
  }
  await saveSourceCredential(sourceId, { apiKey });
  if (project && !source.project) {
    updatePreferences(preferences => {
      const entry = preferences.sources.find(candidate => candidate.id === sourceId);
      if (entry) entry.project = project;
    });
  }
  await invalidateRuntime();
  return (await sourcesOverview()).sources.find(candidate => candidate.id === sourceId)!;
}

async function stopUsingConnections(connectionIds: string[]): Promise<void> {
  revokeApprovalsForConnections(connectionIds);
}

/** Turn a source on or off. Off stops every call through it now, and keeps its accounts. */
export async function setSourceEnabled(sourceId: string, enabled: boolean): Promise<{ dependentAccounts: number }> {
  const { result: found } = updatePreferences(preferences => {
    const entry = preferences.sources.find(candidate => candidate.id === sourceId);
    if (!entry) return false;
    entry.enabled = enabled;
    return true;
  });
  if (!found) throw new SourceError('not_found', 'That source no longer exists.');
  const bound = await listManagedConnections(await connectionStore(), { ownerId: await ownerId(), sourceId });
  if (!enabled) {
    await stopUsingConnections(bound.map(connection => connection.id));
    const open = await openSource(sourceId, { includeDisabled: true }).catch(() => null);
    await invalidateSessions({ sourceId }, open ? { client: open.client } : undefined).catch(() => {});
  }
  await invalidateRuntime();
  return { dependentAccounts: bound.length };
}

/**
 * Remove a source from this home: its accounts leave Ri, its sessions are deleted, its key is
 * forgotten and its id is retired. Accounts in the user's Composio project are left alone unless
 * `revokeRemote` asks to revoke them too, and the result says exactly what happened.
 */
export async function removeSource(sourceId: string, opts: { revokeRemote: boolean }): Promise<{ removedAccounts: number; remote: { accountId: string; outcome: RemoteCleanup }[]; remoteRemaining: number }> {
  const source = findSource(sourceId);
  if (!source) throw new SourceError('not_found', 'That source no longer exists.');
  const store = await connectionStore();
  const bound = await listManagedConnections(store, { ownerId: await ownerId(), sourceId });
  const open = await openSource(sourceId, { includeDisabled: true }).catch(() => null);
  // Local first: nothing can call through the source after this point.
  updatePreferences(preferences => {
    const entry = preferences.sources.find(candidate => candidate.id === sourceId);
    if (entry) entry.enabled = false;
  });
  await stopUsingConnections(bound.map(connection => connection.id));
  await invalidateSessions({ sourceId }, open ? { client: open.client } : undefined).catch(() => {});
  const remote: { accountId: string; outcome: RemoteCleanup }[] = [];
  if (opts.revokeRemote && open) {
    for (const connection of bound) remote.push({ accountId: connection.accountId, outcome: await revokeRemoteAccount(open, connection.accountId) });
  }
  for (const connection of bound) await store.delete(connection.id);
  updatePreferences(preferences => {
    preferences.sources = preferences.sources.filter(candidate => candidate.id !== sourceId);
    preferences.retiredSourceIds = [...new Set([...preferences.retiredSourceIds, sourceId])];
    if (preferences.preferredSourceId === sourceId) delete preferences.preferredSourceId;
    for (const [app, method] of Object.entries(preferences.applicationMethods)) {
      if (method && isManagedMethod(method) && method.sourceId === sourceId) delete preferences.applicationMethods[app as ApplicationId];
    }
    for (const connection of bound) delete preferences.calendarUse[connection.id];
  });
  deleteSourceCredential(sourceId);
  await invalidateRuntime();
  const remoteRemaining = opts.revokeRemote ? remote.filter(item => item.outcome.kind === 'failed').length + (open ? 0 : bound.length) : bound.length;
  return { removedAccounts: bound.length, remote, remoteRemaining };
}

export async function renameSource(sourceId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 60) throw new SourceError('invalid', 'A source name is 1 to 60 characters.');
  const { result } = updatePreferences(preferences => {
    const entry = preferences.sources.find(candidate => candidate.id === sourceId);
    if (entry) entry.label = trimmed;
    return Boolean(entry);
  });
  if (!result) throw new SourceError('not_found', 'That source no longer exists.');
  await invalidateRuntime();
}

/** The overall preference for new connections. Null clears it. */
export function setPreferredSource(sourceId: string | null): void {
  updatePreferences(preferences => {
    if (sourceId === null) { delete preferences.preferredSourceId; return; }
    if (!preferences.sources.some(source => source.id === sourceId)) throw new SourceError('not_found', 'That source no longer exists.');
    preferences.preferredSourceId = sourceId;
  });
}

/** An explicit per-application method. Null removes the override, restoring the overall rule. */
export function setApplicationMethod(applicationId: ApplicationId, method: ApplicationMethod | null): void {
  updatePreferences(preferences => {
    if (method === null) { delete preferences.applicationMethods[applicationId]; return; }
    if (isManagedMethod(method) && !preferences.sources.some(source => source.id === method.sourceId)) {
      throw new SourceError('not_found', 'That source no longer exists.');
    }
    preferences.applicationMethods[applicationId] = method;
  });
}

// ─── Method selection ────────────────────────────────────────────────────────

async function sourceHealthMap(): Promise<Record<string, SourceHealth>> {
  const overview = await sourcesOverview();
  return Object.fromEntries(overview.sources.map(source => [source.id, {
    usable: source.enabled && source.hasKey && source.health.state !== 'key_rejected',
    ...(source.health.state === 'key_rejected' ? { reason: `${source.label} rejected its key. Update the key under Sources.` }
      : !source.hasKey ? { reason: `${source.label} has no key. Add it under Sources.` } : {}),
  } satisfies SourceHealth]));
}

async function directConfigured(providerId: string): Promise<boolean> {
  return (await sourceServiceDeps()).directConfigured(providerId);
}

export async function connectionMethod(applicationId: ApplicationId, capability: Capability = 'agent_tools'): Promise<MethodSelection> {
  const app = APPLICATIONS[applicationId];
  return selectConnectionMethod({
    applicationId, capability,
    preferences: readPreferences().preferences,
    health: await sourceHealthMap(),
    direct: { providerId: app.direct.providerId, configured: await directConfigured(app.direct.providerId) },
  });
}

// ─── Connecting accounts ─────────────────────────────────────────────────────

/** Where a source sends the browser after consent: the page's own origin when it vouches for it. */
function callbackBase(request: Pick<Request, 'headers' | 'url'> | null): { origin: string | null; base: string } {
  const origin = request ? pageOrigin(request) : null;
  return { origin, base: origin ?? getRemoteBaseUrl() ?? getLocalBaseUrl() };
}

export function callbackUrlFor(base: string, attemptId: string): string {
  const url = new URL('/api/integrations/managed/callback', base);
  url.searchParams.set('attempt', attemptId);
  return url.href;
}

export interface BeginManagedConnectInput {
  applicationId: ApplicationId;
  /** The source to use. Omitted: the method selection's primary, which must be managed. */
  sourceId?: string;
  /** Chosen through "Change method", which records it as the application's override. */
  explicitChoice?: boolean;
  label?: string;
  returnTo?: string | null;
  /** A chat's connection request card this connect answers. */
  requestEventId?: string;
  /** Let Ri's Calendar view and deck read this calendar once connected (default yes). */
  calendarUse?: boolean;
}

export interface BeginManagedConnectResult {
  attemptId: string;
  authorizationUrl: string;
  expiresAt: number;
  sourceLabel: string;
}

async function requireOpenSource(sourceId: string): Promise<OpenSource> {
  const open = await openSource(sourceId);
  if (!open) {
    const source = findSource(sourceId);
    throw new SourceError('unavailable', !source ? 'That source no longer exists.' : !source.enabled ? `${source.label} is turned off.` : `${source.label} has no key. Add it under Sources.`);
  }
  return open;
}

export async function beginManagedConnect(request: Pick<Request, 'headers' | 'url'> | null, input: BeginManagedConnectInput): Promise<BeginManagedConnectResult> {
  if (!isApplicationId(input.applicationId)) throw new SourceError('invalid', 'Unknown application.');
  const selection = await connectionMethod(input.applicationId, 'agent_tools');
  let sourceId = input.sourceId;
  if (!sourceId) {
    const primary = selection.primary;
    if (!primary || primary.kind !== 'managed') throw new SourceError('invalid', selection.notice ?? `No managed source can connect ${APPLICATIONS[input.applicationId].displayName}.`);
    sourceId = primary.source.id;
  }
  const option = [selection.primary, ...selection.alternatives].find(candidate => candidate?.kind === 'managed' && candidate.source.id === sourceId);
  if (!option || option.kind !== 'managed') throw new SourceError('not_found', 'That source no longer exists.');
  if (!option.available) throw new SourceError('unavailable', option.reason ?? `${option.source.label} can't connect this right now.`);
  const override = overrideForChoice(selection, { sourceId }, input.explicitChoice ?? false);
  if (override) setApplicationMethod(input.applicationId, override);

  const label = input.label?.trim() || undefined;
  const chosenSourceId = sourceId;
  return startOnce(JSON.stringify(['connect', chosenSourceId, input.applicationId, input.requestEventId ?? null, label ?? null]), () =>
    startConnect(request, input, chosenSourceId, label));
}

async function startConnect(request: Pick<Request, 'headers' | 'url'> | null, input: BeginManagedConnectInput, sourceId: string, label: string | undefined): Promise<BeginManagedConnectResult> {
  const open = await requireOpenSource(sourceId);
  const existing = findPendingAttempt({ sourceId, applicationId: input.applicationId, purpose: 'connect', ...(input.requestEventId ? { requestEventId: input.requestEventId } : {}) });
  if (existing?.redirectUrl && existing.label === label) {
    return { attemptId: existing.id, authorizationUrl: existing.redirectUrl, expiresAt: existing.expiresAt, sourceLabel: open.source.label };
  }
  const authConfigId = await ensureAuthConfig(open, input.applicationId);
  const attemptId = newAttemptId();
  const { origin, base } = callbackBase(request);
  const link = await open.client.createLink({
    authConfigId, userId: open.source.remoteUserId, callbackUrl: callbackUrlFor(base, attemptId),
    ...(input.label?.trim() ? { alias: input.label.trim().slice(0, 80) } : {}),
  });
  const attempt = createAttempt({
    id: attemptId, ownerId: await ownerId(), sourceId, remoteUserId: open.source.remoteUserId,
    applicationId: input.applicationId, toolkitSlug: toolkitSlugFor(input.applicationId), remoteAuthConfigId: authConfigId,
    remoteAccountId: link.connectedAccountId, purpose: 'connect', redirectUrl: link.redirectUrl,
    ...(input.label?.trim() ? { label: input.label.trim().slice(0, 80) } : {}),
    ...(safeReturnPath(input.returnTo) ? { returnTo: safeReturnPath(input.returnTo)! } : {}),
    ...(origin ? { origin } : {}),
    ...(input.requestEventId ? { requestEventId: input.requestEventId } : {}),
    ...(input.applicationId === 'google_calendar' ? { calendarUse: input.calendarUse ?? true } : {}),
    linkExpiresAt: link.expiresAt,
  });
  return { attemptId: attempt.id, authorizationUrl: link.redirectUrl, expiresAt: attempt.expiresAt, sourceLabel: open.source.label };
}

/** Re-consent for an account whose remote access expired, keeping the same remote account. */
export async function beginManagedReconnect(request: Pick<Request, 'headers' | 'url'> | null, connectionId: string, returnTo?: string | null, requestEventId?: string): Promise<BeginManagedConnectResult> {
  const store = await connectionStore();
  const stored = await store.get(connectionId);
  const config = stored ? managedConfig(stored.connection) : null;
  if (!stored || !config) throw new SourceError('not_found', 'That account is no longer connected.');
  return startOnce(JSON.stringify(['reconnect', connectionId, requestEventId ?? null]), () => startReconnect(request, store, connectionId, config, returnTo, requestEventId));
}

async function startReconnect(
  request: Pick<Request, 'headers' | 'url'> | null, store: ConnectionStore, connectionId: string,
  config: NonNullable<ReturnType<typeof managedConfig>>, returnTo?: string | null, requestEventId?: string,
): Promise<BeginManagedConnectResult> {
  const open = await requireOpenSource(config.sourceId);
  const pending = findPendingAttempt({ sourceId: config.sourceId, applicationId: config.applicationId, purpose: 'reconnect', connectionId, ...(requestEventId ? { requestEventId } : {}) });
  if (pending?.redirectUrl) return { attemptId: pending.id, authorizationUrl: pending.redirectUrl, expiresAt: pending.expiresAt, sourceLabel: open.source.label };
  const attemptId = newAttemptId();
  const { origin, base } = callbackBase(request);
  const refreshed = await open.client.refreshConnectedAccount(config.remoteAccountId, callbackUrlFor(base, attemptId));
  if (!refreshed.redirectUrl) {
    // Composio refreshed it without a consent: nothing for the user to do.
    if (refreshed.status === 'ACTIVE') {
      await store.setStatus(connectionId, 'active');
      await invalidateRuntime();
    }
    throw new SourceError(refreshed.status === 'ACTIVE' ? 'conflict' : 'unavailable', refreshed.status === 'ACTIVE' ? 'The account is working again.' : `Composio couldn't start a reconnect (status ${refreshed.status.toLowerCase()}).`);
  }
  const attempt = createAttempt({
    id: attemptId, ownerId: await ownerId(), sourceId: config.sourceId, remoteUserId: open.source.remoteUserId,
    applicationId: config.applicationId, toolkitSlug: config.remoteToolkit, remoteAuthConfigId: config.remoteAuthConfigId,
    remoteAccountId: config.remoteAccountId, purpose: 'reconnect', connectionId, redirectUrl: refreshed.redirectUrl,
    ...(requestEventId ? { requestEventId } : {}),
    ...(safeReturnPath(returnTo) ? { returnTo: safeReturnPath(returnTo)! } : {}),
    ...(origin ? { origin } : {}),
    linkExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  return { attemptId: attempt.id, authorizationUrl: refreshed.redirectUrl, expiresAt: attempt.expiresAt, sourceLabel: open.source.label };
}

export type AttemptStatus =
  | { status: 'pending'; expiresAt: number }
  | { status: 'completed'; connectionId: string; applicationId: ApplicationId; account: string }
  | { status: 'failed' | 'expired' | 'cancelled'; error: string };

function statusOf(attempt: ConnectAttempt, account?: string): AttemptStatus {
  if (attempt.status === 'pending') return { status: 'pending', expiresAt: attempt.expiresAt };
  if (attempt.status === 'completed') return { status: 'completed', connectionId: attempt.connectionIdResult!, applicationId: attempt.applicationId, account: account ?? attempt.accountResult ?? attempt.label ?? 'account' };
  return { status: attempt.status, error: attempt.error ?? (attempt.status === 'expired' ? 'The sign-in link expired. Start again.' : 'The sign-in did not finish.') };
}

const completing = processState('integrations.managed-completing', () => ({
  inFlight: new Map<string, Promise<AttemptStatus>>(),
  lastPoll: new Map<string, number>(),
}));

/** The polling fallback checks Composio at most this often per attempt. */
const POLL_INTERVAL_MS = 2_000;

/**
 * Finish an attempt if its consent completed. Safe to call from the callback, from polling and
 * after a restart, in any order and any number of times: verification goes through Composio
 * against the stored attempt, the account row is idempotent, and only the first settlement
 * answers a chat card.
 */
export async function completeManagedAttempt(attemptId: string, opts: { hintedAccountId?: string; via: 'callback' | 'poll' }): Promise<AttemptStatus> {
  const attempt = getAttempt(attemptId);
  if (!attempt) throw new SourceError('not_found', 'That sign-in request is unknown or too old. Start again.');
  if (attempt.status !== 'pending') {
    if (attempt.status === 'expired') settleAttempt(attemptId, { status: 'failed', error: 'The sign-in link expired. Start again.' });
    return statusOf(attempt);
  }
  if (opts.via === 'poll') {
    const last = completing.lastPoll.get(attemptId) ?? 0;
    if (Date.now() - last < POLL_INTERVAL_MS && !completing.inFlight.has(attemptId)) return statusOf(attempt);
    completing.lastPoll.set(attemptId, Date.now());
  }
  const inFlight = completing.inFlight.get(attemptId);
  if (inFlight) return inFlight;
  const work = finishAttempt(attempt, opts.hintedAccountId);
  completing.inFlight.set(attemptId, work);
  try {
    return await work;
  } finally {
    completing.inFlight.delete(attemptId);
  }
}

async function finishAttempt(attempt: ConnectAttempt, hintedAccountId?: string): Promise<AttemptStatus> {
  const open = await openSource(attempt.sourceId);
  if (!open) {
    const settled = settleAttempt(attempt.id, { status: 'failed', error: 'The source was turned off or removed before the sign-in finished.' });
    return settled.kind === 'missing' ? { status: 'failed', error: 'That sign-in request is gone.' } : statusOf(settled.attempt);
  }
  const verdict = await verifyAttemptAccount(open.client, attempt, hintedAccountId);
  if (verdict.kind === 'pending') return statusOf(attempt);
  if (verdict.kind === 'failed') {
    const settled = settleAttempt(attempt.id, { status: 'failed', error: verdict.reason });
    return settled.kind === 'missing' ? { status: 'failed', error: verdict.reason } : statusOf(settled.attempt);
  }
  const email = await readVerifiedIdentity(open, attempt.applicationId, verdict.account.id).catch(() => null);
  const store = await connectionStore();
  const owner = await ownerId();
  const fail = (error: string): AttemptStatus => {
    const settled = settleAttempt(attempt.id, { status: 'failed', error });
    return settled.kind === 'missing' ? { status: 'failed', error: 'That sign-in request is gone.' } : statusOf(settled.attempt);
  };

  // The checks above took network time. Whatever happened meanwhile (a cancel, a disconnect, the
  // source turned off) is decided here, in the account's turn, right before the account is saved.
  type Committed = { done: AttemptStatus } | { connection: Awaited<ReturnType<typeof saveManagedConnection>>; settled: ReturnType<typeof settleAttempt> };
  const committed = await withAccountTurn<Committed>(managedConnectionId(attempt.sourceId, verdict.account.id), async () => {
    const current = getAttempt(attempt.id);
    if (!current) return { done: { status: 'failed', error: 'That sign-in request is gone.' } as AttemptStatus };
    if (current.status !== 'pending') return { done: statusOf(current) };
    if (!sourceUsable(attempt.sourceId)) return { done: fail('The source was turned off or removed before the sign-in finished.') };
    if (attempt.purpose === 'reconnect') {
      // The same remote account came back: its row (and every grant on it) is kept as it was.
      const row = attempt.connectionId ? await store.get(attempt.connectionId) : null;
      if (!row || row.connection.accountId !== verdict.account.id) return { done: fail('The account was disconnected while it was reconnecting.') };
    }
    const connection = await saveManagedConnection(store, getIntegrationSecretBox(), {
      ownerId: owner, source: open.source, applicationId: attempt.applicationId, remote: verdict.account, email,
      ...(attempt.label ? { label: attempt.label } : {}),
    });
    const settled = settleAttempt(attempt.id, { status: 'completed', connectionId: connection.id, account: connection.email ?? connection.label ?? undefined });
    if (settled.kind === 'settled' && attempt.applicationId === 'google_calendar' && attempt.calendarUse !== undefined && attempt.purpose === 'connect') {
      updatePreferences(preferences => {
        if (preferences.calendarUse[connection.id] === undefined) preferences.calendarUse[connection.id] = attempt.calendarUse!;
      });
    }
    return { connection, settled };
  });
  if ('done' in committed) return committed.done;

  const { connection, settled } = committed;
  if (settled.kind === 'settled') {
    if (attempt.purpose === 'reconnect') await invalidateSessions({ sourceId: attempt.sourceId, remoteAccountId: verdict.account.id }, { client: open.client }).catch(() => {});
    await invalidateRuntime();
    if (attempt.requestEventId) {
      const { resolveCardWithManagedConnection } = await import('../connection-requests');
      await resolveCardWithManagedConnection(attempt.requestEventId, connection, managedToolkitId(attempt.sourceId, attempt.applicationId))
        .catch(error => console.warn('[integrations] answering the connection card failed', error instanceof Error ? error.message : error));
    }
  }
  const final = settled.kind === 'missing' ? null : settled.attempt;
  return final ? statusOf(final, connection.email ?? connection.label ?? undefined) : { status: 'completed', connectionId: connection.id, applicationId: attempt.applicationId, account: connection.email ?? 'account' };
}

/** Stop waiting for a sign-in, and remove its unfinished remote account. */
export async function cancelManagedAttempt(attemptId: string): Promise<void> {
  const attempt = getAttempt(attemptId);
  if (!attempt || attempt.status !== 'pending') return;
  // In the account's turn, so a sign-in finishing at the same moment either completes first or not at all.
  const settled = await withAccountTurn(managedConnectionId(attempt.sourceId, attempt.remoteAccountId), async () => settleAttempt(attemptId, { status: 'cancelled', error: 'Cancelled.' }));
  if (settled.kind !== 'settled' || attempt.purpose !== 'connect') return;
  const open = await openSource(attempt.sourceId).catch(() => null);
  if (!open) return;
  const account = await open.client.getConnectedAccount(attempt.remoteAccountId).catch(() => null);
  // Only an account this attempt created and nobody finished. A completed one stays.
  if (account && account.userId === attempt.remoteUserId && (account.status === 'INITIATED' || account.status === 'INITIALIZING')) {
    await open.client.deleteConnectedAccount(attempt.remoteAccountId).catch(() => {});
  }
}

// ─── Discovery and import ───────────────────────────────────────────────────

export interface DiscoveredAccount {
  remoteAccountId: string;
  status: RemoteAccount['status'];
  alias?: string;
  createdAt?: string;
  imported: boolean;
}

/** Accounts the source's own remote user has for an application, marked when already in Ri. */
export async function discoverAccounts(sourceId: string, applicationId: ApplicationId): Promise<DiscoveredAccount[]> {
  const open = await requireOpenSource(sourceId);
  const accounts = await listOwnAccounts(open, applicationId);
  const local = await listManagedConnections(await connectionStore(), { ownerId: await ownerId(), sourceId, applicationId });
  return accounts.filter(account => account.status === 'ACTIVE' || account.status === 'EXPIRED').map(account => ({
    remoteAccountId: account.id, status: account.status, ...(account.alias ? { alias: account.alias } : {}),
    ...(account.createdAt ? { createdAt: account.createdAt } : {}),
    imported: local.some(connection => connection.accountId === account.id),
  }));
}

/** Bring one existing remote account of the bound user into Ri. It gets no agent access. */
export async function importAccount(sourceId: string, applicationId: ApplicationId, remoteAccountId: string, label?: string) {
  const open = await requireOpenSource(sourceId);
  const account = await open.client.getConnectedAccount(remoteAccountId).catch(error => {
    if (isComposioApiError(error) && error.kind === 'not_found') throw new SourceError('not_found', 'That account no longer exists in Composio.');
    throw error;
  });
  // Project-key access to other users' accounts is not a reason to expose them.
  if (account.userId !== open.source.remoteUserId || account.toolkitSlug !== toolkitSlugFor(applicationId)) {
    throw new SourceError('rejected', 'That account belongs to another user or app in this Composio project. Connect a new account instead.');
  }
  if (account.status !== 'ACTIVE') throw new SourceError('unavailable', 'That account needs to be reconnected in Composio first.');
  const email = await readVerifiedIdentity(open, applicationId, account.id).catch(() => null);
  const store = await connectionStore();
  const owner = await ownerId();
  const connection = await withAccountTurn(managedConnectionId(sourceId, account.id), async () => {
    if (!sourceUsable(sourceId)) throw new SourceError('unavailable', 'The source was turned off while the account was being added.');
    return saveManagedConnection(store, getIntegrationSecretBox(), { ownerId: owner, source: open.source, applicationId, remote: account, email, ...(label ? { label } : {}) });
  });
  await invalidateRuntime();
  return connection;
}

// ─── Disconnect and revoke ───────────────────────────────────────────────────

async function managedConnection(connectionId: string) {
  const store = await connectionStore();
  const stored = await store.get(connectionId);
  const config = stored ? managedConfig(stored.connection) : null;
  if (!stored || !config) throw new SourceError('not_found', 'That account is no longer connected.');
  return { store, connection: stored.connection, config };
}

/**
 * Stop using one account in Ri. Calls through it stop now: the row goes, its sessions and
 * pending approvals are invalidated. The remote account stays in the Composio project.
 */
export async function disconnectManaged(connectionId: string): Promise<{ sourceLabel: string; remoteRemains: true }> {
  const { store, connection, config } = await managedConnection(connectionId);
  await withAccountTurn(connection.id, () => store.delete(connection.id));
  await stopUsingConnections([connection.id]);
  const open = await openSource(config.sourceId, { includeDisabled: true }).catch(() => null);
  await invalidateSessions({ sourceId: config.sourceId, remoteAccountId: config.remoteAccountId }, open ? { client: open.client } : undefined).catch(() => {});
  updatePreferences(preferences => { delete preferences.calendarUse[connection.id]; });
  await invalidateRuntime();
  return { sourceLabel: findSource(config.sourceId)?.label ?? 'Composio', remoteRemains: true };
}

/** Disconnect locally, then revoke that exact remote account, reporting partial cleanup. */
export async function revokeManaged(connectionId: string): Promise<{ sourceLabel: string; outcome: RemoteCleanup }> {
  const { config } = await managedConnection(connectionId);
  const open = await openSource(config.sourceId, { includeDisabled: true });
  const { sourceLabel } = await disconnectManaged(connectionId);
  if (!open) return { sourceLabel, outcome: { kind: 'failed', reason: `${sourceLabel} has no key, so the account was only removed from Ri.` } };
  return { sourceLabel, outcome: await revokeRemoteAccount(open, config.remoteAccountId) };
}

export async function renameManaged(connectionId: string, label: string): Promise<void> {
  const { store, connection } = await managedConnection(connectionId);
  const trimmed = label.trim().slice(0, 80);
  const stored = await store.get(connection.id);
  if (!stored) return;
  await store.save({ ...connection, ...(trimmed ? { label: trimmed } : { label: undefined }), updatedAt: new Date().toISOString() }, stored.sealed);
  await invalidateRuntime();
}

/** Let (or stop) Ri's Calendar view and deck read a managed calendar. Agent access is separate. */
export async function setCalendarUse(connectionId: string, enabled: boolean): Promise<void> {
  const { config } = await managedConnection(connectionId);
  if (config.applicationId !== 'google_calendar') throw new SourceError('invalid', 'Only calendars can be shown in Ri\'s Calendar.');
  updatePreferences(preferences => { preferences.calendarUse[connectionId] = enabled; });
  const { clearCalendarRangeCache } = await import('@/lib/calendar/service');
  clearCalendarRangeCache();
}

