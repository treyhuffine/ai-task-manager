import { describe, expect, it } from 'vitest';
import type { TeamRecordView } from '@/lib/spaces/team-links';
import { describeTeamRecord } from './team-record';

const view = (patch: Partial<TeamRecordView>): TeamRecordView => ({
  state: 'found', homeId: 'team-1', teamName: 'Ball Coach', title: 'Fix login', status: 'todo', localId: null, ...patch,
});

describe('describeTeamRecord', () => {
  it('shows a live record and opens the team', () => {
    expect(describeTeamRecord('task', view({}))).toMatchObject({ label: 'Fix login', team: 'Ball Coach', reason: null, opens: 'team', done: false });
    expect(describeTeamRecord('task', view({ status: 'done' })).done).toBe(true);
    expect(describeTeamRecord('task', view({ status: 'archived' }))).toMatchObject({ archived: true, muted: true, opens: 'team' });
    expect(describeTeamRecord('note', view({ title: null })).label).toBe('Untitled note');
  });

  it('opens a shared copy in place when there is one, but an Area never has one', () => {
    expect(describeTeamRecord('task', view({ localId: 'local-1' })).opens).toBe('copy');
    expect(describeTeamRecord('area', view({ localId: 'local-1' })).opens).toBe('team');
  });

  it('names an unreadable record by its team and kind, never a title it no longer has', () => {
    for (const state of ['unreachable', 'outdated', 'no_access', 'gone'] as const) {
      const look = describeTeamRecord('task', view({ state, title: null, status: null }));
      expect(look.label).toBe('Ball Coach task');
      expect(look.reason).toContain('Ball Coach');
      expect(look.muted).toBe(true);
    }
    expect(describeTeamRecord('area', view({ state: 'gone', title: null })).label).toBe('Ball Coach Area');
  });

  it('keeps a shared copy\'s title and opens it when the team can\'t answer', () => {
    for (const state of ['unreachable', 'outdated', 'no_access', 'gone'] as const) {
      expect(describeTeamRecord('task', view({ state, title: 'Fix login', localId: 'local-1' }))).toMatchObject({ label: 'Fix login', opens: 'copy' });
    }
  });

  it('only sends an unreachable team\'s link on to its view, where the screen explains and retries', () => {
    expect(describeTeamRecord('task', view({ state: 'unreachable', title: null })).opens).toBe('team');
    for (const state of ['outdated', 'no_access', 'gone', 'unknown_home'] as const) {
      expect(describeTeamRecord('task', view({ state, title: null })).opens).toBeNull();
    }
  });

  it('says nothing about a Home it does not know', () => {
    expect(describeTeamRecord('task', view({ state: 'unknown_home', teamName: null, title: null, status: null }))).toMatchObject({
      label: 'Task in another Ri', team: null, opens: null,
    });
    expect(describeTeamRecord('area', view({ state: 'unknown_home', teamName: null, title: null })).label).toBe('Area in another Ri');
  });
});
