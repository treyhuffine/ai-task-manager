import { expect, it } from 'vitest';
import { encodeSource } from '@/lib/chat-sources/reference';
import { offerSourceToChat, receiveChatSources } from './source-handoff';

const ref = encodeSource({ v: 1, kind: 'integration', toolkitId: 'mail', account: { accountId: 'work', authConfigId: null } });

it('delivers a pending source exactly once to its chat, including a later-mounted editor', () => {
  const seen: string[] = [];
  offerSourceToChat('chat-a', ref);
  const stopOther = receiveChatSources('chat-b', source => { seen.push(source); return true; });
  expect(seen).toEqual([]);
  const stop = receiveChatSources('chat-a', source => { seen.push(source); return true; });
  expect(seen).toEqual([ref]);
  stop();
  const stopAgain = receiveChatSources('chat-a', source => { seen.push(source); return true; });
  expect(seen).toEqual([ref]);
  stopAgain(); stopOther();
});

it('retains a handoff when the editor cannot accept it and rejects malformed references', () => {
  offerSourceToChat('paused', ref);
  const stopPaused = receiveChatSources('paused', () => false); stopPaused();
  const seen: string[] = [];
  const stop = receiveChatSources('paused', source => { seen.push(source); return true; });
  expect(seen).toEqual([ref]); stop();
  expect(() => offerSourceToChat('paused', 'not-a-reference')).toThrow();
});
