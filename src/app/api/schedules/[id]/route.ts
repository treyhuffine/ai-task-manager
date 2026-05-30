/**
 * GET    /api/schedules/<id>   — fetch one
 * PATCH  /api/schedules/<id>   — update
 * DELETE /api/schedules/<id>   — delete (runs survive with scheduleId=NULL)
 *
 * Sub-actions on the same route handler:
 *   POST /api/schedules/<id>?action=run      — fire immediately
 *   POST /api/schedules/<id>?action=reset    — clear consecutive_failures
 */

import { NextRequest } from 'next/server';
import { runAction } from '@/lib/orchestrator/dispatch';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const envelope = await runAction('get_schedule', { id }, { remote: false });
  if (!envelope.ok) {
    const status = envelope.error?.code === 'not_found' ? 404 : 400;
    return Response.json(envelope.error, { status });
  }
  return Response.json(envelope.result);
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const body = await request.json();
  const envelope = await runAction('update_schedule', { id, ...body }, { remote: false });
  if (!envelope.ok) {
    return Response.json(envelope.error, { status: 400 });
  }
  return Response.json(envelope.result);
}

export async function DELETE(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const envelope = await runAction('delete_schedule', { id }, { remote: false });
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
    const envelope = await runAction('run_schedule', { id }, { remote: false });
    if (!envelope.ok) return Response.json(envelope.error, { status: 400 });
    return Response.json(envelope.result);
  }
  if (action === 'reset') {
    const envelope = await runAction(
      'reset_schedule_failures',
      { id },
      { remote: false },
    );
    if (!envelope.ok) return Response.json(envelope.error, { status: 400 });
    return Response.json(envelope.result);
  }
  return Response.json({ error: 'unknown action' }, { status: 400 });
}
