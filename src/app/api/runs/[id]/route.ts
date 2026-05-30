/**
 * GET  /api/runs/<id>          — fetch one
 * POST /api/runs/<id>?action=cancel — best-effort cancel
 */

import { NextRequest } from 'next/server';
import { runAction } from '@/lib/orchestrator/dispatch';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const envelope = await runAction('get_run', { id }, { remote: false });
  if (!envelope.ok) {
    const status = envelope.error?.code === 'not_found' ? 404 : 400;
    return Response.json(envelope.error, { status });
  }
  return Response.json(envelope.result);
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const action = request.nextUrl.searchParams.get('action');
  if (action === 'cancel') {
    const envelope = await runAction('cancel_run', { id }, { remote: false });
    if (!envelope.ok) return Response.json(envelope.error, { status: 400 });
    return Response.json(envelope.result);
  }
  return Response.json({ error: 'unknown action' }, { status: 400 });
}
