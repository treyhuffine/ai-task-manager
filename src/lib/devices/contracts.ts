import type { ApiKeyRole, DeviceKind } from '@/db/types';
import type { PeerRelease } from '@/lib/releases/compatibility';
export interface DeviceKeyView {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  env: 'live' | 'test';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  /**
   * `home`: the home's own key, which Ri itself uses on the home's device.
   * Otherwise its role (`api_keys.role`): `worker`, the key the device's
   * worker runs agents with, or `sign_in`, a browser, the phone app or a CLI.
   */
  role: 'home' | ApiKeyRole;
  /** The key this request was made with. */
  current: boolean;
}
export interface DeviceView {
  id: string;
  name: string;
  kind: DeviceKind;
  platform: string | null;
  hostname: string | null;
  status: 'active' | 'revoked';
  /** Where the home runs. */
  isHome: boolean;
  /** Set on the home's own device: whether it's a laptop, so schedules run only while it's awake. */
  portable?: boolean;
  /** The device this browser signs in from. */
  isThisDevice: boolean;
  /** Whether it runs agents: the home always does, another device while its worker key is active. */
  runsAgents: boolean;
  /** When it was last heard from. */
  lastSeenAt: string | null;
  /** Its worker, for any device but the home's own. */
  /** The Home's running build. Does not grant installation authority. */
  release?: PeerRelease['release'];
  worker: {
    enrolled: boolean;
    connected: boolean;
    protocol: number | null;
    version: string | null;
    /** What it last said about itself. Asleep only when it said so: silence is unavailable, not asleep. */
    reportedState: 'awake' | 'asleep' | 'stopped' | null;
    compatibility?: {
      state: 'compatible' | 'update-required' | 'unknown'; release?: PeerRelease['release'];
      protocol?: number; capabilities: string[]; update?: 'home' | 'worker' | 'both'; reason?: string;
      reportedAt?: string; pendingEvents?: number; pendingCommands?: number; openTurns?: number;
    };
  } | null;
  keys: DeviceKeyView[];
}