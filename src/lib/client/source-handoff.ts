'use client';

import { decodeSource } from '@/lib/chat-sources/reference';

/**
 * A reference handed to a chat's composer: the chip, and optionally a starter
 * prompt to write after it, as ChatGPT's Try fills "@Todoist What's on my list
 * today?" into a new chat.
 */
export interface SourceOffer { sourceRef: string; prompt?: string }

// A short-lived, tab-local handoff. The editor's normal draft persistence takes
// over only after insertion. Never sends a message or changes a grant.
const pending = new Map<string, Map<string, SourceOffer>>();
const listeners = new Map<string, Set<() => void>>();
const key = (offer: SourceOffer) => `${offer.sourceRef}\n${offer.prompt ?? ''}`;

export function offerSourceToChat(chatId: string, sourceRef: string, options: { prompt?: string } = {}) {
  decodeSource(sourceRef);
  queue(chatId, { sourceRef, ...promptOf(options.prompt) });
}

function promptOf(value: string | undefined): { prompt?: string } {
  const prompt = value?.trim() || undefined;
  if (prompt && (prompt.length > 500 || /[\r\n]/.test(prompt))) throw new Error('A starter prompt is one short line.');
  return prompt ? { prompt } : {};
}

function queue(chatId: string, offer: SourceOffer) {
  const offers = pending.get(chatId) ?? new Map<string, SourceOffer>();
  if (offers.size >= 16 && !offers.has(key(offer))) throw new Error('Open the chat before adding more sources.');
  offers.set(key(offer), offer); pending.set(chatId, offers);
  for (const listener of listeners.get(chatId) ?? []) listener();
}

export function receiveChatSources(chatId: string, insert: (offer: SourceOffer) => boolean): () => void {
  const receive = () => {
    const offers = pending.get(chatId);
    if (!offers) return;
    for (const [id, offer] of offers) if (insert(offer)) offers.delete(id);
    if (!offers.size) pending.delete(chatId);
  };
  const subscribers = listeners.get(chatId) ?? new Set<() => void>();
  subscribers.add(receive); listeners.set(chatId, subscribers);
  receive();
  return () => { subscribers.delete(receive); if (!subscribers.size) listeners.delete(chatId); };
}
