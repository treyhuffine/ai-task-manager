import { processState } from '@/lib/process-state';

// All writers advance this counter, including disconnects and failed syncs
// that clear content. A viewer must reload both tasks and notes after either.
const state = processState('spaces:generation', () => ({ value: 0 }));
export function teamSyncGeneration(): number { return state.value; }
export function teamContentChanged(): void { state.value++; }
