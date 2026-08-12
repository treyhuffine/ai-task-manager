/**
 * GET  /api/triggers  — list with optional filters
 * POST /api/triggers  — create
 *
 * Server-side wrapper around the orchestrator's `list_triggers` and
 * `create_trigger` actions so the UI gets the same validation +
 * derived behavior the CLI and MCP get.
 */

import { NextRequest } from 'next/server';
import { runAction } from '@/lib/orchestrator/dispatch';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
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

  const envelope = await runAction('list_triggers', input, { remote: false });
  if (!envelope.ok) {
    return Response.json(envelope.error, { status: 400 });
  }
  return Response.json(envelope.result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const envelope = await runAction('create_trigger', body, { remote: false });
  if (!envelope.ok) {
    return Response.json(envelope.error, { status: 400 });
  }
  return Response.json(envelope.result, { status: 201 });
}
