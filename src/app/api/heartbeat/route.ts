/**
 * GET /api/heartbeat  — the heartbeat's settings and status
 * PUT /api/heartbeat  — change any of its settings (partial)
 *
 * Server-side wrapper around the orchestrator's `get_heartbeat` and
 * `update_heartbeat` actions, so Settings, the deck chip, the CLI, and agents
 * all share one validated path. "Check in now" is `run_trigger` on the
 * returned `triggerId` (POST /api/triggers/:id?action=run).
 * See docs/heartbeat-spec.md §6.
 */

import { NextRequest } from 'next/server';
import { runAction } from '@/lib/orchestrator/dispatch';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  const envelope = await runAction('get_heartbeat', {}, { remote: false });
  if (!envelope.ok) return Response.json(envelope.error, { status: 500 });
  return Response.json(envelope.result);
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const envelope = await runAction('update_heartbeat', body, { remote: false });
  if (!envelope.ok) {
    const status = envelope.error?.code === 'invalid_params' || envelope.error?.code === 'not_found' ? 400 : 500;
    return Response.json(envelope.error, { status });
  }
  return Response.json(envelope.result);
}
