/**
 * GET  /api/schedules  — list with optional filters
 * POST /api/schedules  — create
 *
 * Server-side wrapper around the orchestrator's `list_schedules` and
 * `create_schedule` actions so the UI gets the same validation +
 * derived behavior the CLI and MCP get.
 */

import { NextRequest } from 'next/server';
import { runAction } from '@/lib/orchestrator/dispatch';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const input: Record<string, unknown> = {};
  const enabled = params.get('enabled');
  if (enabled === 'true') input.enabled = true;
  else if (enabled === 'false') input.enabled = false;
  const workspaceId = params.get('workspaceId');
  if (workspaceId === 'null') input.workspaceId = null;
  else if (workspaceId) input.workspaceId = workspaceId;
  const targetKind = params.get('targetKind');
  if (targetKind) input.targetKind = targetKind;

  const envelope = await runAction('list_schedules', input, { remote: false });
  if (!envelope.ok) {
    return Response.json(envelope.error, { status: 400 });
  }
  return Response.json(envelope.result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const envelope = await runAction('create_schedule', body, { remote: false });
  if (!envelope.ok) {
    return Response.json(envelope.error, { status: 400 });
  }
  return Response.json(envelope.result, { status: 201 });
}
