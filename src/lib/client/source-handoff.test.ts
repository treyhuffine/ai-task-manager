import { expect, it } from 'vitest';
import { encodeSource } from '@/lib/chat-sources/reference';
import { offerSourceToChat, receiveChatSources, type SourceOffer } from './source-handoff';

const ref = encodeSource({ v: 1, kind: 'integration', toolkitId: 'mail', account: { accountId: 'work', authConfigId: null } });

it('delivers a pending source exactly once to its chat, including a later-mounted editor', () => {
  const seen: SourceOffer[] = [];
  offerSourceToChat('chat-a', ref);
  const stopOther = receiveChatSources('chat-b', offer => { seen.push(offer); return true; });
  expect(seen).toEqual([]);
  const stop = receiveChatSources('chat-a', offer => { seen.push(offer); return true; });
  expect(seen).toEqual([{ sourceRef: ref }]);
  stop();
  const stopAgain = receiveChatSources('chat-a', offer => { seen.push(offer); return true; });
  expect(seen).toEqual([{ sourceRef: ref }]);
  stopAgain(); stopOther();
});

it('retains a handoff when the editor cannot accept it and rejects malformed references', () => {
  offerSourceToChat('paused', ref);
  const stopPaused = receiveChatSources('paused', () => false); stopPaused();
  const seen: SourceOffer[] = [];
  const stop = receiveChatSources('paused', offer => { seen.push(offer); return true; });
  expect(seen).toEqual([{ sourceRef: ref }]); stop();
  expect(() => offerSourceToChat('paused', 'not-a-reference')).toThrow();
});

it('carries a one-line starter prompt with its chip, once per distinct prompt', () => {
  offerSourceToChat('try', ref, { prompt: "  What's on my list today?  " });
  offerSourceToChat('try', ref, { prompt: "What's on my list today?" });
  const seen: SourceOffer[] = [];
  const stop = receiveChatSources('try', offer => { seen.push(offer); return true; });
  expect(seen).toEqual([{ sourceRef: ref, prompt: "What's on my list today?" }]);
  stop();
  expect(() => offerSourceToChat('try', ref, { prompt: 'Two\nlines' })).toThrow('one short line');
  expect(() => offerSourceToChat('try', ref, { prompt: 'x'.repeat(501) })).toThrow('one short line');
});
