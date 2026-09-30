/**
 * This home's devices as Settings, Devices and every "where does it run"
 * menu show them (docs/homes-spec.md §5.1): each device once, what it is,
 * whether it runs agents, and the keys it signs in with. The home's own
 * device runs agents in process, so it has no worker and is always
 * available while the home answers.
 */

import { runtimeReleaseIdentity } from '@/lib/releases/runtime-identity';
import { workerCompatibilityView } from '@/lib/workers/update-compatibility';
import type { ApiKeyRecord } from '@/db/types';
import type { DeviceKeyView, DeviceView } from '@/lib/api/devices';
import { isHostKeyHash } from '@/lib/auth/host-key';
import { getHome, listApiKeys, listDevices, listEnrolledDeviceIds } from '@/lib/db/queries';
import { hostIsPortable } from '@/lib/home/portable';
import { isDeviceConnected } from '@/lib/workers/hub';

function keyView(key: ApiKeyRecord, callerKeyId: string | null): DeviceKeyView {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    suffix: key.suffix,
    env: key.env,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    role: isHostKeyHash(key.hash) ? 'home' : key.role,
    current: key.id === callerKeyId,
  };
}

export async function listDeviceViews(opts: { includeRevoked?: boolean; callerKeyId?: string | null } = {}): Promise<DeviceView[]> {
  const hostId = getHome()?.hostDeviceId ?? null;
  const portable = await hostIsPortable();
  const enrolled = listEnrolledDeviceIds();
  const all = listDevices({ includeRevoked: opts.includeRevoked });
  const byId = new Map(all.map((d) => [d.id, d]));
  const keys = new Map<string, DeviceKeyView[]>();
  for (const key of listApiKeys({ includeRevoked: opts.includeRevoked })) {
    if (!key.deviceId || !byId.has(key.deviceId)) continue;
    const list = keys.get(key.deviceId) ?? [];
    list.push(keyView(key, opts.callerKeyId ?? null));
    keys.set(key.deviceId, list);
  }
  return all.map((d) => {
    const isHome = d.id === hostId;
    const deviceKeys = keys.get(d.id) ?? [];
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      platform: d.platform,
      hostname: d.hostname,
      status: d.status,
      isHome,
      release: isHome ? runtimeReleaseIdentity() : undefined,
      // The home on a laptop: its schedules run only while it's awake (P3.4).
      portable: isHome ? portable : undefined,
      isThisDevice: deviceKeys.some((k) => k.current),
      runsAgents: d.status === 'active' && (isHome || enrolled.has(d.id)),
      lastSeenAt: d.lastSeenAt,
      worker: isHome
        ? null
        : {
            enrolled: enrolled.has(d.id),
            connected: isDeviceConnected(d.id),
            protocol: d.workerProtocol,
            version: d.workerVersion,
            reportedState: d.reportedState,
            compatibility: workerCompatibilityView(d.id, d.name, d.workerProtocol),
          },
      keys: deviceKeys,
    };
  });
}
