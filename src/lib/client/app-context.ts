type Reference = { viewId: string; revision: number };
const contexts = new Map<string, () => Promise<Reference>>();
export function registerAppContext(chatId: string, flush: () => Promise<Reference>) { contexts.set(chatId, flush); return () => { if (contexts.get(chatId) === flush) contexts.delete(chatId); }; }
export async function flushAppContext(chatId: string) { return contexts.get(chatId)?.(); }
