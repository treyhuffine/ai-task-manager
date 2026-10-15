/**
 * The Composio source adapter's account operations (docs/connector-service-spec.md §8): checking
 * a key, the Ri-owned managed auth config per toolkit, Connect Links, verifying a completed
 * consent against the stored attempt, the provider identity of an account, discovery within the
 * bound remote user, and remote cleanup. Vendor shapes stay in ./client.ts. Execution lives in
 * ../managed-provider.ts, typed Calendar reads in ../calendar-reads.ts.
 */
import { IntegrationError } from '@integrations/engine';
import { APPLICATIONS } from '../applications';
import { updatePreferences } from '../preferences';
import type { OpenSource } from '../source-runtime';
import type { ApplicationId } from '../types';
import { COMPOSIO_CATALOG, PINNED_TOOLKIT_VERSIONS } from './catalog';
import { isComposioApiError, type ComposioClient, type RemoteAccount, type RemoteTool } from './client';
import type { ConnectAttempt } from '../attempts';

export function toolkitSlugFor(applicationId: ApplicationId): string {
  const slug = APPLICATIONS[applicationId].remoteToolkits.composio;
  if (!slug) throw new IntegrationError('provider_not_configured', `${APPLICATIONS[applicationId].displayName} isn't available through Composio.`);
  return slug;
}

/** Name of the auth config Ri creates and owns in the user's project. */
export function riAuthConfigName(sourceId: string, toolkitSlug: string): string {
  return `Ri ${toolkitSlug} (${sourceId})`;
}

/**
 * The Composio-managed auth config Ri uses for a toolkit. Ri creates its own instead of reusing
 * whichever config a project lists first, which could carry another app's custom scopes. The id
 * is remembered on the source and re-checked before every new consent.
 */
export async function ensureAuthConfig(open: OpenSource, applicationId: ApplicationId): Promise<string> {
  const toolkitSlug = toolkitSlugFor(applicationId);
  const configs = await open.client.listAuthConfigs(toolkitSlug);
  const remembered = open.source.authConfigs?.[toolkitSlug];
  const usable = (id: string | undefined) => configs.find(config => config.id === id && config.enabled && config.managed && config.toolkitSlug === toolkitSlug);
  let chosen = usable(remembered);
  // A crash after creating one but before remembering it: adopt the one with Ri's name.
  chosen ??= configs.find(config => config.name === riAuthConfigName(open.source.id, toolkitSlug) && config.enabled && config.managed && config.toolkitSlug === toolkitSlug);
  const id = chosen?.id ?? (await open.client.createManagedAuthConfig(toolkitSlug, riAuthConfigName(open.source.id, toolkitSlug))).id;
  if (id !== remembered) {
    updatePreferences(preferences => {
      const source = preferences.sources.find(candidate => candidate.id === open.source.id);
      if (source) source.authConfigs = { ...(source.authConfigs ?? {}), [toolkitSlug]: id };
    });
  }
  return id;
}

export type VerifyOutcome =
  | { kind: 'active'; account: RemoteAccount }
  | { kind: 'pending' }
  | { kind: 'failed'; reason: string };

/**
 * Check a consent against its attempt through Composio, never through the redirect: the account
 * must be the one this attempt's link created, for this source's remote user, auth config and
 * toolkit. Callback parameters are only a hint to look sooner.
 */
export async function verifyAttemptAccount(client: ComposioClient, attempt: ConnectAttempt, hintedAccountId?: string): Promise<VerifyOutcome> {
  if (hintedAccountId !== undefined && hintedAccountId !== attempt.remoteAccountId) {
    return { kind: 'failed', reason: 'The sign-in finished for a different account than this request started.' };
  }
  let account: RemoteAccount;
  try {
    account = await client.getConnectedAccount(attempt.remoteAccountId);
  } catch (error) {
    if (isComposioApiError(error) && error.kind === 'not_found') return { kind: 'failed', reason: 'The sign-in was removed before it finished.' };
    throw error;
  }
  if (account.userId !== attempt.remoteUserId || account.authConfigId !== attempt.remoteAuthConfigId || account.toolkitSlug !== attempt.toolkitSlug) {
    return { kind: 'failed', reason: "The connected account doesn't match this request." };
  }
  if (account.status === 'INITIATED' || account.status === 'INITIALIZING') return { kind: 'pending' };
  if (account.status !== 'ACTIVE' || account.disabled) return { kind: 'failed', reason: account.statusReason ?? `The sign-in ended as ${account.status.toLowerCase()}.` };
  return { kind: 'active', account };
}

const EMAIL = /^[^\s@]{1,200}@[^\s@]{1,200}$/;

/** Find an email address in a typed read's output, tolerating Composio's wrapper fields. */
function emailIn(data: Record<string, unknown>, keys: string[]): string | undefined {
  const layers: Record<string, unknown>[] = [data];
  for (const wrapper of ['data', 'response_data', 'response']) {
    const inner = data[wrapper];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) layers.push(inner as Record<string, unknown>);
  }
  for (const layer of layers) for (const key of keys) {
    const value = layer[key];
    if (typeof value === 'string' && EMAIL.test(value.trim())) return value.trim().toLowerCase();
  }
  return undefined;
}

/**
 * The provider's own account identity, read through a pinned typed read. It is shown beside the
 * user's label and never replaced by it. Null when the provider doesn't say.
 */
export async function readVerifiedIdentity(open: OpenSource, applicationId: ApplicationId, remoteAccountId: string): Promise<string | null> {
  const catalog = COMPOSIO_CATALOG[applicationId];
  const result = await open.client.executePinned({
    toolSlug: catalog.identity.slug,
    version: PINNED_TOOLKIT_VERSIONS[catalog.toolkitSlug]!,
    userId: open.source.remoteUserId,
    connectedAccountId: remoteAccountId,
    arguments: catalog.identity.arguments,
    read: true,
  });
  if (!result.successful) return null;
  return emailIn(result.data, applicationId === 'gmail' ? ['emailAddress', 'email_address', 'email'] : ['id', 'email']) ?? null;
}

/** Accounts of this source's remote user only. Other users in the project are never listed. */
export async function listOwnAccounts(open: OpenSource, applicationId?: ApplicationId): Promise<RemoteAccount[]> {
  const accounts = await open.client.listConnectedAccounts({
    userIds: [open.source.remoteUserId],
    ...(applicationId ? { toolkitSlugs: [toolkitSlugFor(applicationId)] } : {}),
  });
  return accounts.filter(account => account.userId === open.source.remoteUserId);
}

/** The latest definitions of the reviewed tools for one application. */
export async function catalogDefinitions(open: OpenSource, applicationId: ApplicationId): Promise<RemoteTool[]> {
  const catalog = COMPOSIO_CATALOG[applicationId];
  const slugs = catalog.actions.map(action => action.slug);
  const tools = await open.client.listTools(catalog.toolkitSlug, slugs);
  return tools.filter(tool => slugs.includes(tool.slug) && (!tool.toolkitSlug || tool.toolkitSlug === catalog.toolkitSlug));
}

export type RemoteCleanup =
  | { kind: 'revoked'; revokedTokens: string[] }
  | { kind: 'revoke_unsupported'; disabled: boolean }
  | { kind: 'failed'; reason: string };

/**
 * Revoke one remote account and remove it from the project, reporting exactly what happened.
 * Upstream revocation is best effort at Composio, so an unsupported revoke falls back to
 * disabling and deleting the remote account. Never touches other accounts or the project.
 */
export async function revokeRemoteAccount(open: OpenSource, remoteAccountId: string): Promise<RemoteCleanup> {
  let outcome: RemoteCleanup;
  try {
    const revoked = await open.client.revokeConnectedAccount(remoteAccountId);
    outcome = { kind: 'revoked', revokedTokens: revoked.revokedTokens };
  } catch (error) {
    if (!isComposioApiError(error) || (error.kind !== 'invalid' && error.kind !== 'conflict' && error.kind !== 'not_found')) {
      return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
    if (error.kind === 'not_found') return { kind: 'revoked', revokedTokens: [] };
    let disabled = false;
    try {
      await open.client.setConnectedAccountEnabled(remoteAccountId, false);
      disabled = true;
    } catch { /* reported below */ }
    outcome = { kind: 'revoke_unsupported', disabled };
  }
  try {
    await open.client.deleteConnectedAccount(remoteAccountId);
  } catch (error) {
    if (!(isComposioApiError(error) && error.kind === 'not_found')) {
      return { kind: 'failed', reason: `The account was ${outcome.kind === 'revoked' ? 'revoked' : 'disabled'} but not removed from Composio: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return outcome;
}
