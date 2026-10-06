import { NextRequest, NextResponse } from 'next/server';
import { isDesktopRequest } from '@/lib/integrations/desktop-oauth';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { listRailSessions } from '@/lib/db/queries';
import { listRunningSessions, listSessionsWithPending } from '@/lib/executor/status-snapshot';
import { classifySession } from '@/lib/sessions/classification';
import { sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import {
  DESKTOP_ACTIVITY_TARGET_LIMIT, desktopActivityLabel,
  type DesktopActivityData, type DesktopActivityKind, type DesktopActivityTarget,
} from '@/lib/sessions/desktop-activity-contract';

const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

/** One row per active execution, exactly like the rail and Agents view.
 * A blocked turn counts once as needsInput, never as both running and input.
 * Provider background tasks alone are not running turns. */
export function GET(request: NextRequest) {
  if (!isDesktopRequest(request) || !isInstallationOwner(request)) return json({ error: 'Use the local owner desktop to view activity.' }, 403);
  try {
    const pending = new Set(listSessionsWithPending());
    const running = new Set(listRunningSessions());
    const counts = { needsInput: 0, unread: 0, running: 0 };
    const targets: Record<DesktopActivityKind, DesktopActivityTarget[]> = { needsInput: [], unread: [], running: [] };
    for (const session of sortSessionsHotnessDesc(listRailSessions())) {
      if (session.status !== 'active') continue;
      const bucket = classifySession(session, pending, running);
      const state: DesktopActivityKind | null = bucket === 'needsApproval' ? 'needsInput' : bucket === 'working' ? 'running' : bucket === 'unread' ? 'unread' : null;
      if (!state) continue;
      counts[state] += 1;
      if (targets[state].length < DESKTOP_ACTIVITY_TARGET_LIMIT) targets[state].push({
        sessionId: session.id, state,
        label: desktopActivityLabel(session.execution?.label ?? session.label),
      });
    }
    const activity: DesktopActivityData = { ...counts, attention: counts.needsInput + counts.unread,
      targets: [...targets.needsInput, ...targets.unread, ...targets.running].slice(0, DESKTOP_ACTIVITY_TARGET_LIMIT) };
    return json(activity);
  } catch {
    return json({ error: 'Desktop activity is temporarily unavailable.' }, 503);
  }
}
