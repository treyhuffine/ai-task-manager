/** Each mounted chat composer proves its draft is retained before a reload. */
const writers = new Map<object, () => boolean>();
export function registerChatDraftWriter(owner: object, writer: () => boolean) {
  writers.set(owner, writer);
  return () => { writers.delete(owner); };
}
export function flushChatDrafts(): void {
  for (const writer of writers.values()) {
    if (!writer()) throw new Error('A chat draft could not be saved on this device. Keep this view open.');
  }
}
