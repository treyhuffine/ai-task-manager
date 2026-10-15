'use client';

import { decodeSource } from '@/lib/chat-sources/reference';

// A short-lived, tab-local handoff. The editor's normal draft persistence takes
// over only after insertion. Never sends a message or changes a grant.
const pending = new Map<string, Set<string>>();
const listeners = new Map<string, Set<() => void>>();

export function offerSourceToChat(chatId: string, sourceRef: string) {
  decodeSource(sourceRef);
  const sources = pending.get(chatId) ?? new Set<string>();
  if (sources.size >= 16 && !sources.has(sourceRef)) throw new Error('Open the chat before adding more sources.');
  sources.add(sourceRef); pending.set(chatId, sources);
  for (const listener of listeners.get(chatId) ?? []) listener();
}

export function receiveChatSources(chatId: string, insert: (sourceRef: string) => boolean): () => void {
  const receive = () => {
    const sources = pending.get(chatId);
    if (!sources) return;
    for (const source of sources) if (insert(source)) sources.delete(source);
    if (!sources.size) pending.delete(chatId);
  };
  const subscribers = listeners.get(chatId) ?? new Set<() => void>();
  subscribers.add(receive); listeners.set(chatId, subscribers);
  receive();
  return () => { subscribers.delete(receive); if (!subscribers.size) listeners.delete(chatId); };
}
