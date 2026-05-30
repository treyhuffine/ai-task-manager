/**
 * POST /api/triggers/<publicId>
 *
 * External webhook intake for schedules with `kind='webhook'`. The
 * publicId in the path identifies the schedule; HMAC-SHA256 over the
 * raw body authenticates the request (see `lib/scheduler/webhook.ts`
 * for the auth shape). On success, enqueues a run via the same
 * `dispatchRun` path used by the scheduler tick.
 *
 * Headers expected:
 *   - `X-Webhook-Secret: <plaintext>` — the secret shown at create.
 *   - `X-Signature: sha256=<hex>` — HMAC of the raw body with the
 *      secret.
 *   - `Content-Type` — anything; we tolerate non-JSON.
 *
 * Responses:
 *   - 202 `{ runId }` — accepted, dispatch in flight
 *   - 401 — bad/missing signature or secret
 *   - 404 — unknown publicId or schedule disabled
 *   - 413 — body exceeds 256 KiB
 *
 * The endpoint is exempted from the bearer-token middleware in
 * `src/proxy.ts`. It's the schedule's HMAC signature that gates entry.
 */

import { NextRequest } from 'next/server';
import { findScheduleByWebhookPublicId } from '@/lib/db/queries';
import { dispatchRun } from '@/lib/runs/dispatch';
import {
  verifyWebhookRequest,
  WEBHOOK_BODY_MAX_BYTES,
} from '@/lib/scheduler/webhook';

interface RouteContext {
  params: Promise<{ public_id: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const { public_id: publicId } = await ctx.params;
  if (!publicId) {
    return Response.json({ error: 'missing public id' }, { status: 404 });
  }

  // Read raw bytes BEFORE parsing — HMAC is over the original buffer,
  // not a re-serialized JSON.
  const rawBuffer = Buffer.from(await request.arrayBuffer());
  if (rawBuffer.byteLength > WEBHOOK_BODY_MAX_BYTES) {
    return Response.json(
      { error: 'body too large', maxBytes: WEBHOOK_BODY_MAX_BYTES },
      { status: 413 },
    );
  }

  const schedule = findScheduleByWebhookPublicId(publicId);
  if (!schedule || !schedule.enabled || !schedule.webhookSecretHash) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  const auth = verifyWebhookRequest({
    rawBody: rawBuffer,
    signatureHeader: request.headers.get('x-signature'),
    secretHeader: request.headers.get('x-webhook-secret'),
    storedSecretHash: schedule.webhookSecretHash,
  });
  if (!auth.ok) {
    return Response.json(
      { error: 'unauthorized', reason: auth.reason },
      { status: 401 },
    );
  }

  // Tolerant body parsing: prefer JSON when the content sniffs as
  // JSON, else fall through as raw string. Either way the payload
  // lands on `runs.triggerPayload` and gets fenced into the prompt.
  let payload: Record<string, unknown> | string;
  const ctype = request.headers.get('content-type') ?? '';
  if (rawBuffer.byteLength === 0) {
    payload = '';
  } else if (ctype.includes('json')) {
    try {
      payload = JSON.parse(rawBuffer.toString('utf8')) as Record<string, unknown>;
    } catch {
      payload = rawBuffer.toString('utf8');
    }
  } else {
    payload = rawBuffer.toString('utf8');
  }

  try {
    const result = await dispatchRun({
      schedule,
      trigger: 'webhook',
      triggerPayload: payload,
      scheduledFor: new Date().toISOString(),
    });
    return Response.json(
      { runId: result.run.id, status: result.run.status },
      { status: 202 },
    );
  } catch (err) {
    console.error('[POST /api/triggers/:public_id]', err);
    const message = err instanceof Error ? err.message : 'dispatch failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
