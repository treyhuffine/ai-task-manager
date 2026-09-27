/** Unsubmitted capture content must survive native navigation and Quit guards.
 * It may remain in the hidden live renderer, unlike active voice recording. */
const captures = new Set<object>();
export function retainCaptureDraft(owner: object, pending: boolean) {
  if (pending) captures.add(owner);
  else captures.delete(owner);
}
export function hasPendingCapture() { return captures.size > 0; }
