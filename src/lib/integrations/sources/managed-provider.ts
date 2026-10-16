/**
 * Managed sources in the integration engine (docs/connector-service-spec.md §§7, 9, 10). Each
 * enabled source contributes one provider and toolkit per application, namespaced by the source
 * (`cmpk3fa_gmail`), whose actions are the reviewed catalog. Calls run through the engine's
 * `runAction` like every other action, so account pins, approval cards, redaction and run events
 * apply unchanged. The source adds only its transport:
 *
 *   1. Before approval, `validateForConnection` checks the source is usable and the account is the
 *      exact one this connection is bound to.
 *   2. At dispatch, the call takes the account's constrained session (./composio/sessions.ts), and
 *      the tool's live version and schema must equal the ones Ri registered and the user approved.
 *      A change refreshes Ri's tools and fails the call, so it is validated and approved again.
 *   3. The call executes once. A write whose outcome is unknown is reported as indeterminate and
 *      recorded, never retried.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import { action, defineProvider, defineToolkit, IntegrationError, NeedsReauthError } from '@integrations/engine';
import type { Action, ActionContext, Connection, ConnectionStore, Credentials, Redactor, Registry } from '@integrations/engine';
import { remoteAccount } from '@integrations/engine/auth';
import { jsonSchemaToZodObject } from '@integrations/engine/mcp';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';
import { getIntegrationsDir } from '../storage';
import { getActionOverride, defaultApprovalMode } from '../write-policy';
import { APPLICATIONS, managedToolkitId } from './applications';
import { argumentSummary, newOperationId, recordManagedAction } from './audit';
import { catalogDefinitions } from './composio/adapter';
import { COMPOSIO_CATALOG, type CatalogAction } from './composio/catalog';
import { isComposioApiError, type ComposioApiError, type RemoteTool } from './composio/client';
import { acquireSession, invalidateSessions, schemaHash, schemaShapeHash, type SessionTarget } from './composio/sessions';
import { managedConfig } from './managed-connections';
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { readPreferences } from './preferences';
import { processState } from '@/lib/process-state';
import { openSource, sourceUsable, type OpenSource } from './source-runtime';
import { sourceCredentialRevision } from './source-credentials';
import type { ApplicationId, SourceEntry } from './types';

export const TOOLS_CACHE_FILE = 'managed-tools-cache.json';

interface RegisteredTool {
  slug: string;
  version: string;
  /** From the project tool listing, the definition the model and approvals see. */
  schemaHash: string;
  /**
   * The same definition reduced to what it accepts (`schemaShapeHash`). The session's listing must
   * match it, so wording or key order may differ between listings but fields, types and
   * requirements may not.
   */
  shapeHash: string;
}

export interface ManagedSourceStatus {
  sourceId: string;
  state: 'ok' | 'disabled' | 'no_key' | 'key_rejected' | 'unreachable' | 'cached';
  detail?: string;
}

export interface ManagedBuildResult {
  sources: ManagedSourceStatus[];
  /** Some definitions came from the cache: retry discovery soon. */
  discoveryUnavailable: boolean;
}

export interface ManagedBuildDeps {
  registry: Registry;
  store: ConnectionStore;
  redactor: Redactor;
  ownerId: string;
  /** Rebuild the runtime: a tool's definition changed under Ri. */
  onToolsChanged: () => void;
  /** The approval gate allows every call (development's default), so the audit never claims a human approved. */
  approvalBypassed?: boolean;
}

/**
 * What the built runtime depends on in the managed source files. Compared on every runtime use,
 * so a change another process made (a new key, a disabled source) reaches this one.
 */
export function managedSourcesSignature(): string {
  const read = readPreferences();
  return JSON.stringify({
    status: read.status,
    sources: read.preferences.sources.map(source => ({
      id: source.id, kind: source.kind, label: source.label, enabled: source.enabled, remoteUserId: source.remoteUserId,
      credential: sourceCredentialRevision(source.id) ?? null,
    })),
  });
}

/** At most one tool refresh per source in this window, so a lagging listing can't loop rebuilds. */
const TOOLS_CHANGED_DAMPING_MS = 30_000;
const toolsChanged = processState('integrations.managed-tools-changed', () => ({ last: new Map<string, number>() }));

function reportToolsChanged(deps: ManagedBuildDeps, sourceId: string): void {
  const now = Date.now();
  if (now - (toolsChanged.last.get(sourceId) ?? 0) < TOOLS_CHANGED_DAMPING_MS) return;
  toolsChanged.last.set(sourceId, now);
  deps.onToolsChanged();
}

/** The session's tool still matches what Ri registered and the user approved. */
function sessionToolMatches(expected: RegisteredTool, live: { version: string; shapeHash: string } | undefined): boolean {
  return Boolean(live && live.version === expected.version && live.shapeHash === expected.shapeHash);
}

// ─── Definition cache (an outage keeps the last known tools) ─────────────────

const cachedToolSchema = z.object({
  slug: z.string(), name: z.string(), description: z.string(), toolkitSlug: z.string().optional(),
  inputParameters: z.record(z.string(), z.unknown()), version: z.string().optional(),
  availableVersions: z.array(z.string()), deprecated: z.boolean(), noAuth: z.boolean(),
});
const cacheSchema = z.record(z.string(), z.record(z.string(), z.object({ fetchedAt: z.string(), tools: z.array(cachedToolSchema) })));

function cachePath(): string {
  return path.join(getIntegrationsDir(), TOOLS_CACHE_FILE);
}

function readCache(): z.infer<typeof cacheSchema> {
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(fs.readFileSync(cachePath(), 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function writeCache(sourceId: string, applicationId: ApplicationId, tools: RemoteTool[]): void {
  const file = cachePath();
  withFileLock(file, () => {
    const cache = readCache();
    cache[sourceId] = { ...(cache[sourceId] ?? {}), [applicationId]: { fetchedAt: new Date().toISOString(), tools } };
    atomicWriteFile(file, `${JSON.stringify(cache, null, 2)}\n`);
  });
}

// ─── Registration ─────────────────────────────────────────────────────────────

export async function registerManagedSources(deps: ManagedBuildDeps): Promise<ManagedBuildResult> {
  const read = readPreferences();
  const result: ManagedBuildResult = { sources: [], discoveryUnavailable: false };
  if (read.status !== 'ok') return result;
  for (const source of read.preferences.sources) {
    if (!source.enabled) { result.sources.push({ sourceId: source.id, state: 'disabled' }); continue; }
    const open = await openSource(source.id).catch(() => null);
    if (!open) { result.sources.push({ sourceId: source.id, state: 'no_key' }); continue; }
    deps.redactor.register(open.apiKey, 'composio_api_key');
    let state: ManagedSourceStatus = { sourceId: source.id, state: 'ok' };
    for (const applicationId of Object.keys(COMPOSIO_CATALOG) as ApplicationId[]) {
      let tools: RemoteTool[];
      try {
        tools = await catalogDefinitions(open, applicationId);
        writeCache(source.id, applicationId, tools);
      } catch (error) {
        const cached = readCache()[source.id]?.[applicationId]?.tools ?? [];
        tools = cached as RemoteTool[];
        const rejected = isComposioApiError(error) && (error.kind === 'unauthorized' || error.kind === 'forbidden');
        state = { sourceId: source.id, state: rejected ? 'key_rejected' : cached.length ? 'cached' : 'unreachable',
          detail: deps.redactor.redact(error instanceof Error ? error.message : String(error)) };
        if (!rejected) result.discoveryUnavailable = true;
      }
      registerApplication(deps, open, applicationId, tools);
    }
    result.sources.push(state);
  }
  return result;
}

function registerApplication(deps: ManagedBuildDeps, open: OpenSource, applicationId: ApplicationId, tools: RemoteTool[]): void {
  const source = open.source;
  const app = APPLICATIONS[applicationId];
  const catalog = COMPOSIO_CATALOG[applicationId];
  const toolkitId = managedToolkitId(source.id, applicationId);
  const displayName = `${app.displayName} via ${source.label}`;
  const registered = new Map<string, RegisteredTool>();
  const actions: Action[] = [];
  for (const entry of catalog.actions) {
    const definition = tools.find(tool => tool.slug === entry.slug);
    // A tool Composio doesn't list (or lists without a version) is unavailable, not guessed.
    if (!definition?.version || definition.deprecated) continue;
    registered.set(entry.slug, {
      slug: entry.slug, version: definition.version, schemaHash: schemaHash(definition.inputParameters), shapeHash: schemaShapeHash(definition.inputParameters),
    });
    actions.push(managedAction({ deps, source, applicationId, toolkitId, displayName, entry, definition, registered }));
  }
  const bindingFor = (connection: Connection) => {
    const config = managedConfig(connection);
    if (!config || connection.providerId !== toolkitId || config.sourceId !== source.id || config.remoteAccountId !== connection.accountId) return undefined;
    return {
      isCurrentCredential: (credential: Credentials) => credential.type === 'remote_account'
        && credential.sourceId === source.id && credential.remoteAccountId === connection.accountId
        // Read live: another process may have disabled the source or removed its key.
        && sourceUsable(source.id),
    };
  };
  deps.registry.addBundle({
    provider: defineProvider({ id: toolkitId, displayName, auth: remoteAccount(), externalAuth: { forConnection: bindingFor } }),
    toolkits: [defineToolkit({ id: toolkitId, providerId: toolkitId, displayName, actions })],
  });
}

function approvalFor(actionId: string, entry: CatalogAction, bypassed: boolean): 'not_required' | 'standing' | 'granted' | 'dev_auto' {
  if (!entry.mutating) return 'not_required';
  if (bypassed) return 'dev_auto';
  const mode = getActionOverride(actionId) ?? defaultApprovalMode({ actionId, risk: entry.risk, mutating: entry.mutating });
  return mode === 'auto' ? 'standing' : 'granted';
}

function managedAction(input: {
  deps: ManagedBuildDeps; source: SourceEntry; applicationId: ApplicationId; toolkitId: string; displayName: string;
  entry: CatalogAction; definition: RemoteTool; registered: Map<string, RegisteredTool>;
}): Action {
  const { deps, source, applicationId, toolkitId, displayName, entry, definition, registered } = input;
  const actionId = `${toolkitId}.${entry.op}`;
  const vendorDescription = definition.description.replace(/\s+/g, ' ').trim().slice(0, 900);
  const description = `${entry.summary} ${vendorDescription} (${displayName})`.trim();

  const requireBinding = (connection: ActionContext['connection'], config: Record<string, unknown> | undefined) => {
    const binding = managedConfig({ config });
    if (!binding || binding.sourceId !== source.id || binding.remoteAccountId !== connection.accountId || connection.providerId !== toolkitId) {
      throw new IntegrationError('connection_not_found', 'This account is not bound to this source.');
    }
    return binding;
  };

  const result = action({
    id: actionId,
    description,
    input: jsonSchemaToZodObject(definition.inputParameters),
    mutating: entry.mutating,
    risk: entry.risk,
    async execute(ctx, args) {
      const binding = requireBinding(ctx.connection, ctx.config);
      const open = await openSource(source.id);
      if (!open) throw new IntegrationError('provider_not_configured', `${source.label} is turned off or has no key. Check it in ${INTEGRATION_LABELS.plural}.`);
      const expected = registered.get(entry.slug)!;
      const target: SessionTarget = {
        sourceId: source.id, remoteUserId: open.source.remoteUserId, remoteAccountId: binding.remoteAccountId,
        toolkitSlug: COMPOSIO_CATALOG[applicationId].toolkitSlug, slugs: [...registered.keys()],
      };
      const operationId = newOperationId();
      const common = {
        operationId, sourceId: source.id, sourceKind: source.kind, connectionId: ctx.connection.id, remoteAccountId: binding.remoteAccountId,
        actionId, slug: entry.slug, version: expected.version, schemaHash: expected.schemaHash, mutating: entry.mutating, risk: entry.risk,
      };
      const started = Date.now();
      const finish = (outcome: 'ok' | 'failed' | 'uncertain' | 'refused', extra: { errorCode?: string; error?: string; logId?: string } = {}) =>
        recordManagedAction({ ...common, phase: 'outcome', outcome, durationMs: Date.now() - started, ...extra }, value => deps.redactor.redact(value));

      // Session and definition checks happen before anything can reach the provider.
      let session;
      try {
        session = await acquireSession(target, { client: open.client }, { fresh: entry.mutating });
      } catch (error) {
        finish('refused', { errorCode: 'session', error: error instanceof Error ? error.message : String(error) });
        throw toIntegrationError(error, false, displayName);
      }
      if (!sessionToolMatches(expected, session.tools.get(entry.slug))) {
        reportToolsChanged(deps, source.id);
        finish('refused', { errorCode: 'tools_changed' });
        throw new IntegrationError('tools_changed', `${displayName} changed ${entry.op} at ${source.label}. Ri refreshed its tools. Check the new definition and call it again.`);
      }
      // Setting up the session took network time: the source may have been turned off or the
      // account disconnected meanwhile. Check the live state right before anything is sent.
      const stillAllowed = async () => {
        let problem: IntegrationError | null = null;
        if (!sourceUsable(source.id)) problem = new IntegrationError('provider_not_configured', `${source.label} is turned off or has no key. Check it in ${INTEGRATION_LABELS.plural}.`);
        else {
          const current = await deps.store.get(ctx.connection.id);
          const bound = current ? managedConfig(current.connection) : null;
          if (!current || current.connection.status !== 'active' || bound?.sourceId !== source.id || bound.remoteAccountId !== binding.remoteAccountId) {
            problem = new IntegrationError('connection_not_found', 'This account was disconnected or needs to be reconnected.');
          }
        }
        if (problem) {
          finish('refused', { errorCode: problem.code });
          throw problem;
        }
      };
      await stillAllowed();
      recordManagedAction({ ...common, phase: 'dispatch', approval: approvalFor(actionId, entry, deps.approvalBypassed ?? false), ...argumentSummary(args) });

      let response;
      for (let attempt = 0; ; attempt += 1) {
        try {
          if (attempt > 0) await stillAllowed();
          response = await open.client.executeInSession(session.sessionId, entry.slug, args as Record<string, unknown>, ctx.signal);
          break;
        } catch (error) {
          // A missing session refused the call before anything ran: rebuild it once.
          if (attempt === 0 && isComposioApiError(error) && error.kind === 'not_found' && !error.maybeApplied) {
            await invalidateSessions({ sourceId: source.id, remoteAccountId: binding.remoteAccountId }, { client: open.client }).catch(() => {});
            session = await acquireSession(target, { client: open.client }, { fresh: true });
            if (!sessionToolMatches(expected, session.tools.get(entry.slug))) {
              reportToolsChanged(deps, source.id);
              finish('refused', { errorCode: 'tools_changed' });
              throw new IntegrationError('tools_changed', `${displayName} changed ${entry.op} at ${source.label}. Check the new definition and call it again.`);
            }
            continue;
          }
          const uncertain = entry.mutating && isComposioApiError(error) && error.maybeApplied;
          finish(uncertain ? 'uncertain' : 'failed', { errorCode: isComposioApiError(error) ? error.kind : 'error', error: error instanceof Error ? error.message : String(error) });
          throw toIntegrationError(error, entry.mutating, displayName);
        }
      }
      if (response.result_type === 'input_required') {
        finish('refused', { errorCode: 'input_required' });
        throw new IntegrationError('denied', `${source.label} asked for input before running ${entry.op}. Ri doesn't answer vendor prompts, so it stopped.`);
      }
      if (response.result_type === 'failed') {
        const detail = deps.redactor.redact(response.error ?? 'The provider refused the request.');
        finish('failed', { errorCode: 'provider_error', error: detail, ...(response.log_id ? { logId: response.log_id } : {}) });
        // An expired or revoked account is a reconnect for that exact account, nothing wider.
        const account = await open.client.getConnectedAccount(binding.remoteAccountId).catch(() => null);
        if (account && (account.status !== 'ACTIVE' || account.disabled)) {
          await deps.store.setStatus(ctx.connection.id, 'needs_reauth', `remote status ${account.status}`).catch(() => {});
          throw new NeedsReauthError(ctx.connection.id);
        }
        throw new IntegrationError('provider_error', `${displayName} couldn't ${entry.op.replace(/_/g, ' ')}: ${detail}`);
      }
      finish('ok', { ...(response.log_id ? { logId: response.log_id } : {}) });
      return { via: source.label, account: ctx.connection.email ?? ctx.connection.label ?? ctx.connection.accountId, data: response.data ?? {} };
    },
  });
  return {
    ...result,
    validateForConnection: connection => {
      // Before approval: never ask the user to approve a call that can't run.
      if (!sourceUsable(source.id)) throw new IntegrationError('provider_not_configured', `${source.label} is turned off or has no key. Check it in ${INTEGRATION_LABELS.plural}.`);
      if (connection.providerId !== toolkitId) throw new IntegrationError('connection_not_found', 'This account is not bound to this source.');
    },
  };
}

/** Map a Composio failure to the engine taxonomy. A possibly-applied write is indeterminate. */
export function toIntegrationError(error: unknown, mutating: boolean, displayName: string): Error {
  if (error instanceof IntegrationError || error instanceof NeedsReauthError) return error;
  if (!isComposioApiError(error)) {
    return new IntegrationError('provider_error', error instanceof Error ? error.message : String(error));
  }
  const e = error as ComposioApiError;
  const indeterminate = mutating && e.maybeApplied;
  const uncertainty = indeterminate ? ' It may have run. Check before trying again.' : '';
  switch (e.kind) {
    case 'unauthorized':
    case 'forbidden':
      return new IntegrationError('provider_not_configured', `Composio rejected the project key for ${displayName}. Repair it in ${INTEGRATION_LABELS.plural}.`, { status: e.status });
    case 'rate_limited':
      return new IntegrationError('provider_rate_limited', `Composio's rate limit was reached for ${displayName}.${uncertainty}`, {
        status: e.status, indeterminate, ...(e.retryAfterMs ? { retryAfter: Math.ceil(e.retryAfterMs / 1000) } : {}),
      });
    case 'payment_required':
      return new IntegrationError('provider_rate_limited', `The Composio project's usage limit was reached. ${displayName} is paused until it resets or the plan changes.`, { status: e.status });
    case 'timeout':
      return new IntegrationError('provider_timeout', `${displayName} didn't answer in time.${uncertainty}`, { indeterminate });
    case 'unavailable':
    case 'cancelled':
      return new IntegrationError('provider_unavailable', `Composio is unavailable for ${displayName}.${uncertainty}`, { status: e.status, indeterminate });
    case 'not_found':
      return new IntegrationError('connection_not_found', `${displayName} couldn't find that account at Composio.`, { status: e.status });
    case 'unexpected_response':
      return new IntegrationError('provider_error', `${e.message}${uncertainty}`, { status: e.status, indeterminate });
    default:
      return new IntegrationError('provider_error', e.message, { status: e.status });
  }
}
