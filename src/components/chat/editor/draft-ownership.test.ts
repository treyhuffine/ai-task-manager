import { expect, it } from 'vitest';
import { decodeChatDraft, DRAFT_STORAGE_PREFIX, encodeChatDraft, restoreChatDraft, scopedDraftKey } from './draft-storage';

const maya = { homeId: 'team-a', viewerId: 'maya' };
const noa = { homeId: 'team-a', viewerId: 'noa' };
const personal = { homeId: 'personal-home', viewerId: 'local' };
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsent private text' }] }] };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

it.each(['exec:chat', 'launcher:agent', 'launcher:new'])('separates the Home and author for %s', base => {
  expect(scopedDraftKey(base, maya)).not.toBe(scopedDraftKey(base, noa));
  expect(scopedDraftKey(base, maya)).not.toBe(scopedDraftKey(base, { ...maya, homeId: 'team-b' }));
  const key = scopedDraftKey(base, maya);
  expect(scopedDraftKey(key, maya)).toBe(key);
  expect(decodeChatDraft(key, encodeChatDraft(key, doc), maya)).toEqual(doc);
  expect(decodeChatDraft(key, encodeChatDraft(key, doc), noa)).toBeNull();
});

it('refuses another author even if their serialized draft is copied into the current key', () => {
  const mayasKey = scopedDraftKey('exec:chat', maya);
  const noasKey = scopedDraftKey('exec:chat', noa);
  expect(decodeChatDraft(noasKey, encodeChatDraft(mayasKey, doc), noa)).toBeNull();
});

it('does not restore or remove the previous member’s draft on a member switch', () => {
  const store = storage();
  const key = scopedDraftKey('exec:chat', maya);
  store.setItem(DRAFT_STORAGE_PREFIX + key, encodeChatDraft(key, doc));
  expect(restoreChatDraft(store, scopedDraftKey('exec:chat', noa), noa, false)).toBeNull();
  expect(restoreChatDraft(store, key, maya, false)).toEqual(doc);
});

it.each(['exec:chat', 'launcher:agent', 'launcher:new'])('carries the existing personal %s draft forward without losing text', base => {
  const store = storage();
  store.setItem(DRAFT_STORAGE_PREFIX + base, JSON.stringify(doc));
  const key = scopedDraftKey(base, personal);
  expect(restoreChatDraft(store, key, personal, true)).toEqual(doc);
  expect(store.getItem(DRAFT_STORAGE_PREFIX + base)).toBeNull();
  expect(restoreChatDraft(store, key, personal, true)).toEqual(doc);
});

it('never adopts an unscoped draft in a Team document', () => {
  const store = storage();
  store.setItem(DRAFT_STORAGE_PREFIX + 'exec:chat', JSON.stringify(doc));
  expect(restoreChatDraft(store, scopedDraftKey('exec:chat', maya), maya, false)).toBeNull();
  expect(store.getItem(DRAFT_STORAGE_PREFIX + 'exec:chat')).toBe(JSON.stringify(doc));
});

it('retains the old personal draft if scoped persistence fails', () => {
  const store = storage();
  store.setItem(DRAFT_STORAGE_PREFIX + 'exec:chat', JSON.stringify(doc));
  store.setItem = () => { throw new Error('quota'); };
  expect(restoreChatDraft(store, scopedDraftKey('exec:chat', personal), personal, true)).toEqual(doc);
  expect(store.getItem(DRAFT_STORAGE_PREFIX + 'exec:chat')).toBe(JSON.stringify(doc));
});
