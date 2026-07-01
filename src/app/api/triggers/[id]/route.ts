/**
 * GET    /api/triggers/<id>   — fetch one
 * PATCH  /api/triggers/<id>   — update
 * DELETE /api/triggers/<id>   — delete (runs survive with triggerId=NULL)
 *
 * Sub-actions on the same route handler:
 *   POST /api/triggers/<id>?action=run      — fire immediately
 *   POST /api/triggers/<id>?action=reset    — clear consecutive_failures
 */

import { NextRequest } from 'next/server';
import { runAction } from '@/lib/orchestrator/dispatch';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const envelope = await runAction('get_trigger', { id }, { remote: false });
  if (!envelope.ok) {
    const status = envelope.error?.code === 'not_found' ? 404 : 400;
    return Response.json(envelope.error, { status });
  }
  return Response.json(envelope.result);
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const body = await request.json();
  const envelope = await runAction('update_trigger', { id, ...body }, { remote: false });
  if (!envelope.ok) {
    return Response.json(envelope.error, { status: 400 });
  }
  return Response.json(envelope.result);
}

export async function DELETE(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const envelope = await runAction('delete_trigger', { id }, { remote: false });
  if (!envelope.ok) {
    return Response.json(envelope.error, { status: 400 });
  }
  return Response.json(envelope.result);
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const params = request.nextUrl.searchParams;
  const action = params.get('action');
  if (action === 'run') {
    const envelope = await runAction('run_trigger', { id }, { remote: false });
    if (!envelope.ok) return Response.json(envelope.error, { status: 400 });
    return Response.json(envelope.result);
  }
  if (action === 'reset') {
    const envelope = await runAction(
      'reset_trigger_failures',
      { id },
      { remote: false },
    );
    if (!envelope.ok) return Response.json(envelope.error, { status: 400 });
    return Response.json(envelope.result);
  }
  return Response.json({ error: 'unknown action' }, { status: 400 });
}
