/** Only content not yet retained on this device must prevent an unload. */
const captures = new Set<object>();
const writers = new Map<object, () => Promise<void>>();
export function retainCaptureDraft(owner: object, pending: boolean) {
  if (pending) captures.add(owner);
  else captures.delete(owner);
}
export function hasPendingCapture() { return captures.size > 0; }
export function registerCaptureWriter(owner: object, flush: () => Promise<void>) {
  writers.set(owner, flush);
  return () => { writers.delete(owner); captures.delete(owner); };
}
export async function flushCaptureDrafts() {
  const results = await Promise.allSettled([...writers.values()].map(flush => flush()));
  if (results.some(result => result.status === 'rejected') || hasPendingCapture()) throw new Error('Some capture content could not be saved on this device.');
}
