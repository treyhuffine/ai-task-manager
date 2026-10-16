type Reference = {viewId: string; revision: number};
const contexts = new Map<string, Map<string, () => Promise<Reference | undefined>>>();
const selected = new Map<string, string>();
export function selectConnectedContext(chatId: string, viewId: string) { selected.set(chatId, viewId); }
export function registerConnectedContext(chatId: string, viewId: string, flush: () => Promise<Reference | undefined>) {
  const entries = contexts.get(chatId) ?? new Map();
  contexts.set(chatId, entries); entries.set(viewId, flush);
  return () => { if (entries.get(viewId) === flush) entries.delete(viewId); if (!entries.size) {contexts.delete(chatId); selected.delete(chatId);} };
}
export async function flushConnectedContext(chatId: string) {
  const viewId = selected.get(chatId);
  const flush = viewId ? contexts.get(chatId)?.get(viewId) : undefined;
  const reference = await flush?.();
  return reference ? [reference] : [];
}
