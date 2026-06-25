import { NextResponse } from 'next/server';
import { listSchedules } from '@/lib/db/queries';

/**
 * Orchestrator-target schedules — the candidates for "custom digests" (spec §2.9). Each can have
 * its result delivered to notification channels via `deliverResultTo` (set with PATCH below).
 */
export function GET() {
  const digests = listSchedules({ targetKind: 'orchestrator' }).map((s) => ({
    id: s.id,
    name: s.name,
    enabled: s.enabled,
    deliverResultTo: s.deliverResultTo ?? [],
  }));
  return NextResponse.json({ digests });
}
