/**
 * Who can change a computer's updates (docs/always-on-spec.md 7.1). Those
 * settings decide what software the computer runs, so its own pairing key can do
 * everything, and exactly one step wider: the owner of the personal Home here,
 * from any of their paired devices, can turn automatic updates on or off and press
 * Update now. Both only ever move to a release the installation already trusts.
 */
import { getRequestKey } from '@/lib/auth/request-key';
import { isTeamAuthority } from '@/lib/home/authority';
import { isDefaultHomeTeam } from './home-lookup';
import { isInstallationOwner } from './owner-auth';
import type { ServiceStatus } from './client';
import type { UpdateAction } from './update-settings';

export interface UpdateRights {
  /** Everything: the channel, the origin, rollback and uninstalling. */
  manage: boolean;
  /** The automatic updates switch, Update now and Not now. */
  use: boolean;
}

export function updateRights(request: Pick<Request, 'headers'>): UpdateRights {
  if (isInstallationOwner(request)) return { manage: true, use: true };
  const key = getRequestKey(request.headers as Headers);
  if (!key) return { manage: false, use: false };
  // A team's Settings changes nothing when the computer also runs a personal Home,
  // since the switch belongs to the computer. On a team server, its owner has it.
  if (isTeamAuthority()) return { manage: false, use: key.scope === 'member' && key.memberRole === 'owner' && isDefaultHomeTeam() };
  return { manage: false, use: key.scope === 'viewer' };
}

/**
 * What service status a caller sees. The local recovery window can show redacted
 * Next.js startup diagnostics, so anyone else gets the state without local error
 * excerpts, including errors the updater kept after a release failed to boot. A
 * team's members get the update state and nothing about the computer hosting it.
 */
export function visibleServiceStatus(status: ServiceStatus | null, rights: UpdateRights) {
  if (!status || rights.manage) return status;
  const genericError = 'Service needs attention. Check this device’s local recovery window.';
  const redacted = { ...status, ...(status.error ? { error: genericError } : {}), ...(status.update?.error ? { update: { ...status.update, error: genericError } } : {}) };
  if (!isTeamAuthority()) return redacted;
  if (!redacted.update) return { phase: status.phase, version: status.version } as ServiceStatus;
  const update = { ...redacted.update, origin: { source: redacted.update.origin?.source } };
  for (const local of ['checkpoint', 'rollback', 'local'] as const) delete update[local];
  return { phase: status.phase, version: status.version, update } as ServiceStatus;
}

const PERSON_ACTIONS: readonly UpdateAction['action'][] = ['apply', 'apply-now', 'later'];
export function mayRunUpdateAction(rights: UpdateRights, action: UpdateAction['action']) {
  return rights.manage || (rights.use && PERSON_ACTIONS.includes(action));
}
