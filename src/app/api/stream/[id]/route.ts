/**
 * PATCH /api/stream/:id — deliberately near-empty. Stream items are an
 * append-only ledger: raw text is immutable (spec §1.2) and every lifecycle
 * transition flows through the dedicated triage routes (decisions, dismiss,
 * reopen, retry) so provenance and telemetry are never skipped. The only
 * generic PATCH left is nothing at all: any field is rejected with a
 * pointer at the right surface.
 */

import type { NextRequest } from 'next/server';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await params;
  let keys: string[] = [];
  try {
    keys = Object.keys(await request.json());
  } catch {
    // fall through — empty body gets the same explanation
  }
  return Response.json(
    {
      error:
        'Stream items are immutable. Use POST /api/stream/:id/dismiss, /reopen, /retry, or the ' +
        'triage decision routes instead.',
      code: 'invalid_params',
      rejectedFields: keys,
    },
    { status: 400 },
  );
}
