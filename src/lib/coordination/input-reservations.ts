import { processState } from '@/lib/process-state';

// Preparation has no native effect yet. These claims bridge its awaits until
// acceptance or a durable device command takes ownership of the input batch.
const preparing = processState('coordination.preparing-inputs', () => new Set<string>());
export const inputIsPreparing = (id: string): boolean => preparing.has(id);
export function claimPreparingInputs(ids: string[]): () => void {
  for (const id of ids) preparing.add(id);
  return () => { for (const id of ids) preparing.delete(id); };
}
