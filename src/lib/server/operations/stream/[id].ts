import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * PATCH /api/stream/:id — deliberately near-empty. Stream items are an
 * append-only ledger: raw text is immutable (spec §1.2) and every lifecycle
 * transition flows through the dedicated triage routes (decisions, dismiss,
 * reopen, retry) so provenance and telemetry are never skipped. The only
 * generic PATCH left is nothing at all: any field is rejected with a
 * pointer at the right surface.
 */

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, _request: OperationContext) {
  let keys: string[] = [];
  try {
    keys = Object.keys(rpcInput.body);
  } catch {
    // fall through — empty body gets the same explanation
  }
  return reply(
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

export const PATCHInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.record(rpcZ.string(), rpcZ.json()) }).strict();
