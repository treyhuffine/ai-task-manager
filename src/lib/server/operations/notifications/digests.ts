import { listTriggers } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';
import { z as rpcZ } from 'zod/v4';

/**
 * Orchestrator-target triggers — the candidates for "custom digests" (spec §2.9). Each can have
 * its result delivered to notification channels via `deliverResultTo` (set with PATCH below). The
 * heartbeat isn't one: what it finds reaches the user as the main agent's message (`agent.message`).
 */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const digests = listTriggers({ targetKind: 'orchestrator' }).filter((s) => s.id !== RESERVED_TRIGGER_IDS.heartbeat).map((s) => ({
    id: s.id,
    name: s.name,
    enabled: s.enabled,
    deliverResultTo: s.deliverResultTo ?? [],
  }));
  return reply({ digests });
}

export const GETInput = rpcZ.object({}).strict().default({});
