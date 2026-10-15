/**
 * How Ri chooses the way to create a new connection for an application (docs/connector-service-spec.md §3).
 * Pure: the caller supplies the preferences, each source's health and whether the direct route
 * works, so the server, the UI and tests share one rule. A choice here never moves an account,
 * grants anything or changes how an existing connection executes.
 *
 *  1. An explicit application override, if it supports the capability and works.
 *  2. Otherwise the overall preferred source, if it supports the capability and works.
 *  3. With no applicable preference, a working direct route first, then another enabled managed
 *     source. Unconfigured routes come last.
 *  4. A saved preference that is disabled, unavailable or lacks the capability is explained, and
 *     the next suitable method is offered. The user still chooses before authorization begins.
 */
import { APPLICATIONS } from './applications';
import { isManagedMethod, type ApplicationId, type ApplicationMethod, type Capability, type SourceEntry, type SourcePreferences } from './types';

export interface SourceHealth {
  /** Enabled, with a credential that verified (or has not failed). */
  usable: boolean;
  /** Why it isn't usable, for the explanation. */
  reason?: string;
}

export interface DirectRoute {
  providerId: string;
  /** A working sign-in exists (a bundled, operator or saved OAuth app). */
  configured: boolean;
}

export type MethodOption =
  | { kind: 'managed'; method: ApplicationMethod; source: Pick<SourceEntry, 'id' | 'kind' | 'label'>; available: boolean; reason?: string }
  | { kind: 'direct'; method: ApplicationMethod; available: boolean; reason?: string }
  /** The source kind can do this, but no source of it is set up. Offered last, as setup. */
  | { kind: 'setup'; sourceKind: SourceEntry['kind']; available: false; reason: string };

export interface MethodSelection {
  applicationId: ApplicationId;
  capability: Capability;
  /** The method the primary Connect button uses, or null when nothing can connect yet. */
  primary: MethodOption | null;
  /** Why the primary was chosen. `fallback` means a saved preference couldn't be used. */
  basis: 'override' | 'preferred' | 'recommended' | 'fallback' | 'none';
  /** Present when a saved preference couldn't be used, explaining why. */
  notice?: string;
  /** Every other method, in the order they should be offered. */
  alternatives: MethodOption[];
}

export interface SelectionInput {
  applicationId: ApplicationId;
  capability: Capability;
  preferences: SourcePreferences;
  health: Record<string, SourceHealth>;
  direct: DirectRoute;
}

function sourceSupports(source: SourceEntry, applicationId: ApplicationId, capability: Capability): boolean {
  const app = APPLICATIONS[applicationId];
  return Boolean(app.remoteToolkits[source.kind]) && app.managedCapabilities.includes(capability);
}

function managedOption(source: SourceEntry, input: SelectionInput): MethodOption {
  const health = input.health[source.id];
  const supports = sourceSupports(source, input.applicationId, input.capability);
  const reason = !source.enabled ? `${source.label} is turned off.`
    : !supports ? `${source.label} can't do this for ${APPLICATIONS[input.applicationId].displayName} yet.`
      : health && !health.usable ? health.reason ?? `${source.label} isn't working right now.` : undefined;
  return { kind: 'managed', method: { sourceId: source.id }, source: { id: source.id, kind: source.kind, label: source.label }, available: !reason, ...(reason ? { reason } : {}) };
}

function directOption(input: SelectionInput, authConfigId?: string): MethodOption {
  const name = APPLICATIONS[input.applicationId].displayName;
  const reason = input.direct.configured ? undefined : `Direct ${name} sign-in needs your own Google OAuth app first.`;
  return {
    kind: 'direct',
    method: { kind: 'direct', providerId: input.direct.providerId, ...(authConfigId ? { authConfigId } : {}) },
    available: !reason, ...(reason ? { reason } : {}),
  };
}

function sameMethod(a: ApplicationMethod, b: ApplicationMethod): boolean {
  if (isManagedMethod(a) || isManagedMethod(b)) return isManagedMethod(a) && isManagedMethod(b) && a.sourceId === b.sourceId;
  return a.providerId === b.providerId && (a.authConfigId ?? null) === (b.authConfigId ?? null);
}

function sameOption(a: MethodOption, b: MethodOption): boolean {
  return a.kind !== 'setup' && b.kind !== 'setup' && sameMethod(a.method, b.method);
}

function optionFor(method: ApplicationMethod, input: SelectionInput): MethodOption | { missing: true } {
  if (isManagedMethod(method)) {
    const source = input.preferences.sources.find(candidate => candidate.id === method.sourceId);
    return source ? managedOption(source, input) : { missing: true };
  }
  return directOption(input, method.authConfigId);
}

export function selectConnectionMethod(input: SelectionInput): MethodSelection {
  const { preferences, applicationId, capability } = input;
  const managed = preferences.sources.map(source => managedOption(source, input));
  const direct = directOption(input);
  // Offer order with no preference: working direct, then usable managed sources, then the rest.
  const ordered: MethodOption[] = [
    ...(direct.available ? [direct] : []),
    ...managed.filter(option => option.available),
    ...managed.filter(option => !option.available),
    ...(direct.available ? [] : [direct]),
  ];
  const kindsSetUp = new Set(preferences.sources.map(source => source.kind));
  const setup: MethodOption[] = (['composio'] as const)
    .filter(kind => !kindsSetUp.has(kind) && APPLICATIONS[applicationId].remoteToolkits[kind]
      && APPLICATIONS[applicationId].managedCapabilities.includes(capability))
    .map(kind => ({ kind: 'setup', sourceKind: kind, available: false, reason: 'Set up Composio once to connect without your own OAuth app.' }));

  const rest = (primary: MethodOption | null) => [...ordered.filter(option => !primary || !sameOption(option, primary)), ...setup];

  const notices: string[] = [];
  const saved: { method: ApplicationMethod; basis: 'override' | 'preferred' }[] = [];
  const override = preferences.applicationMethods[applicationId];
  if (override) saved.push({ method: override, basis: 'override' });
  if (preferences.preferredSourceId) saved.push({ method: { sourceId: preferences.preferredSourceId }, basis: 'preferred' });
  for (const candidate of saved) {
    const option = optionFor(candidate.method, input);
    if ('missing' in option) {
      notices.push(candidate.basis === 'override'
        ? `The method saved for ${APPLICATIONS[applicationId].displayName} no longer exists.`
        : 'Your preferred source no longer exists.');
      continue;
    }
    if (option.available) {
      return { applicationId, capability, primary: option, basis: notices.length ? 'fallback' : candidate.basis,
        ...(notices.length ? { notice: notices.join(' ') } : {}), alternatives: rest(option) };
    }
    notices.push(option.reason ?? 'That method is unavailable.');
  }
  const primary = ordered.find(option => option.available) ?? null;
  const basis = notices.length ? (primary ? 'fallback' : 'none') : primary ? 'recommended' : 'none';
  return { applicationId, capability, primary, basis, ...(notices.length ? { notice: notices.join(' ') } : {}), alternatives: rest(primary) };
}

/**
 * The override an explicit "Change method" choice records. Accepting the recommended method is
 * not a choice and records nothing, so a later change of the overall preference still applies.
 */
export function overrideForChoice(selection: MethodSelection, chosen: ApplicationMethod, explicit: boolean): ApplicationMethod | null {
  if (!explicit) return null;
  const primary = selection.primary;
  if (primary && primary.kind !== 'setup' && sameMethod(primary.method, chosen) && selection.basis !== 'override') return null;
  return chosen;
}
