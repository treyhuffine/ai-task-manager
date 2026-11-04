/**
 * The heartbeat's wire shapes, shared by the server (get_heartbeat /
 * update_heartbeat, /api/heartbeat) and the client hooks. Type-only.
 */

import type { EffortLevel, RunStatus } from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';

/** The most recent check-in that actually ran (skipped slots are not check-ins). */
export interface HeartbeatCheckIn {
  runId: string;
  /** When it started (or was queued, if it never started). */
  at: string;
  completedAt: string | null;
  status: RunStatus;
  /**
   * What it did with what it found: nothing to pass along, told the main agent
   * right away, or saved it for later. Null when it didn't finish, and for
   * check-ins from before notes.
   */
  outcome: 'quiet' | 'told' | 'held' | null;
  /** A note it sent to the main agent couldn't be delivered. */
  handOffFailed: boolean;
  /** Its transcript. Null only for runs that failed before a chat existed. */
  chatSessionId: string | null;
  /** How many tasks, notes, or agents it changed (`runs.artifactRefs`). */
  changedCount: number;
  summary: string | null;
  errorMessage: string | null;
}

export interface HeartbeatConfig {
  /** The reserved trigger row behind it, for the Triggers screen and run history. */
  triggerId: string;
  enabled: boolean;
  /** The user's instructions, sent after the app's ground rules. */
  instructions: string;
  /** True while the instructions equal the seeded default (Reset has nothing to do). */
  instructionsAreDefault: boolean;
  intervalSeconds: number;
  /** HH:MM in `timezone`. Both null means any time of day. */
  activeHoursStart: string | null;
  activeHoursEnd: string | null;
  timezone: string | null;
  provider: HarnessId;
  /** Null means the provider's default model. */
  model: string | null;
  /** Null means the model's default effort. */
  effort: EffortLevel | null;
  serviceTier?: string | null;
  /** The next check-in that will actually run (inside the active hours), or null when off. */
  nextCheckInAt: string | null;
  /** A check-in is running right now. */
  running: boolean;
  lastCheckIn: HeartbeatCheckIn | null;
  /** The last few check-ins, newest first. `lastCheckIn` is the first of them. */
  recentCheckIns: HeartbeatCheckIn[];
  /** Why the app turned it off (e.g. the monthly budget), or null. */
  disabledReason: string | null;
  consecutiveFailures: number;
}

/** A validated patch for `updateHeartbeat`. Absent fields keep their value. */
export interface HeartbeatPatch {
  enabled?: boolean;
  instructions?: string;
  intervalSeconds?: number;
  /** Both set, or both null for any time of day. */
  activeHoursStart?: string | null;
  activeHoursEnd?: string | null;
  timezone?: string;
  harness?: HarnessId;
  model?: string | null;
  effort?: EffortLevel | null;
  serviceTier?: string | null;
}
