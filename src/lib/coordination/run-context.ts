import { processState } from '@/lib/process-state';

/** Set only by the runner or an ownership-checked worker signal. */
const state = processState('coordination.producing-runs', () => new Map<string, string | null>());
export function recordCoordinationProducer(sessionId: string, runId: string | null): void { state.set(sessionId, runId); }
export function coordinationProducer(sessionId: string): string | null | undefined { return state.get(sessionId); }
