import { expect, it } from 'vitest';
import { assertDocumentCredential, homeDocumentKey, homeStorageIdentity } from './document-scope';

it('separates identical canonical IDs by Home and by authenticated author', () => {
  const key = (homeId: string, viewerId: string) => homeDocumentKey('tasks', 'same-id', { homeId, viewerId });
  expect(new Set([key('personal', 'local'), key('team', 'one'), key('team', 'two')]).size).toBe(3);
  expect(key('team:a', 'member:b')).not.toBe(key('team', 'a:member:b'));
});

it('refuses a retained writer after a sign-in changes', () => {
  expect(() => assertDocumentCredential('original', 'replacement')).toThrow(/original author/);
  expect(() => assertDocumentCredential('original', undefined)).toThrow();
  expect(() => assertDocumentCredential('original', 'original')).not.toThrow();
});

it('preserves personal browser preference keys while separating team agents, file paths and panel history', () => {
  expect(homeStorageIdentity('same-id')).toBe('same-id');
  const one = homeStorageIdentity('same-id', { homeId: 'one', viewerId: 'member' });
  expect(one).not.toBe('same-id');
  expect(one).not.toBe(homeStorageIdentity('same-id', { homeId: 'two', viewerId: 'member' }));
  expect(one).not.toBe(homeStorageIdentity('same-id', { homeId: 'one', viewerId: 'another' }));
});
