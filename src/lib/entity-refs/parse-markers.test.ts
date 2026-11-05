import { describe, expect, it } from 'vitest';
import { listEntityMarkers, listNonFileMarkers, parseEntitySegments, referencesEntity, remoteMarkerText, splitRemoteId } from './parse-markers';

describe('referencesEntity', () => {
  it('finds a task or note reference', () => {
    expect(referencesEntity('[[task:01a10837-9062-79d7-bbc3-7baf98a60b9b]] Can we build this?')).toBe(true);
    expect(referencesEntity('see [[note:abc_1.2]] for context')).toBe(true);
  });

  it('ignores files, the scratchpad, malformed markers and empty text', () => {
    expect(referencesEntity('[[file:01a1.png]] and [[scratchpad]]')).toBe(false);
    expect(referencesEntity('[[task:]] [[task]] task:abc')).toBe(false);
    expect(referencesEntity('')).toBe(false);
    expect(referencesEntity(null)).toBe(false);
  });

  it('leaves agents out: their chips draw from the agent list, not the session\'s references', () => {
    expect(referencesEntity('ask [[agent:01a0f1c2-0000-7000-8000-000000000001]]')).toBe(false);
  });
});

describe('agent markers', () => {
  const id = '01a0f1c2-0000-7000-8000-000000000001';

  it('split out of the message in place, like a task', () => {
    expect(parseEntitySegments(`ask [[agent:${id}]] about [[task:t1]]`)).toEqual([
      { kind: 'text', text: 'ask ' },
      { kind: 'marker', marker: { kind: 'agent', id }, raw: `[[agent:${id}]]` },
      { kind: 'text', text: ' about ' },
      { kind: 'marker', marker: { kind: 'task', id: 't1' }, raw: '[[task:t1]]' },
    ]);
    expect(listNonFileMarkers(`[[agent:${id}]] [[file:a.png]]`)).toEqual([{ kind: 'agent', id }]);
  });

  it('stay text without an id', () => {
    expect(parseEntitySegments('[[agent]] [[agent:]]')).toEqual([
      { kind: 'text', text: '[[agent]]' },
      { kind: 'text', text: ' [[agent:]]' },
    ]);
  });
});

describe('a marker for a record in another Home', () => {
  const home = '01a1a3b3-1463-7fdc-a747-bc4860dc8e1d';
  const id = '01a1a3d3-4fd9-705d-ae61-204c7f7e4a84';

  it('parses tasks, notes and Areas, naming the Home', () => {
    for (const recordKind of ['task', 'note', 'area'] as const) {
      expect(listEntityMarkers(`see [[${recordKind}:${home}/${id}]] now`)).toEqual([{ kind: 'remote', recordKind, homeId: home, id }]);
    }
  });

  it('leaves the form a person already has untouched', () => {
    expect(listEntityMarkers(`[[task:${id}]] [[note:${id}]] [[agent:${id}]] [[scratchpad]] [[file:a.png]]`)).toEqual([
      { kind: 'task', id }, { kind: 'note', id }, { kind: 'agent', id }, { kind: 'scratchpad' }, { kind: 'file', fileName: 'a.png' },
    ]);
    expect(listEntityMarkers(`[[area:${id}]]`)).toEqual([]);
  });

  it('falls through as text for a kind that can not be remote, or a broken shape', () => {
    for (const text of [`[[agent:${home}/${id}]]`, `[[file:${home}/${id}]]`, `[[task:${home}/]]`, `[[task:/${id}]]`, `[[task:a/b/c]]`]) {
      expect(listEntityMarkers(text)).toEqual([]);
    }
  });

  it('builds and splits the same form', () => {
    expect(remoteMarkerText('note', home, id)).toBe(`[[note:${home}/${id}]]`);
    expect(splitRemoteId(`${home}/${id}`)).toEqual({ homeId: home, id });
    expect(splitRemoteId(id)).toBeNull();
    expect(splitRemoteId('a/b/c')).toBeNull();
  });
});
