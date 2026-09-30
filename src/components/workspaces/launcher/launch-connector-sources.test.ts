import { describe, expect, it } from 'vitest';
import type { ConnectorTaskIdentity, ConnectorTaskItem, ConnectorTaskResult } from '@/lib/connectors/task-sources';
import { applyPick, composePrompt } from '@/lib/executions/launch-draft';
import { connectorProviderScopes, connectorTaskGroups } from './launch-connector-sources';

const identity = (id: string): ConnectorTaskIdentity => ({
  sourceKey: `todoist:${id}`, toolkitId: 'todoist', providerLabel: 'Todoist',
  connectionId: id, accountId: `user-${id}`, accountLabel: id,
});
const item = (id: string): ConnectorTaskItem => ({
  ...identity(id), key: `todoist:${id}:same`, title: 'Same task title',
  subtitle: 'Tomorrow', body: `Task details for ${id}`, due: '2026-09-30', priority: 1,
  sourceUrl: 'https://app.todoist.com/app/task/same',
});
const state = { isLoading: false, isFetching: false, error: null };
const result = (): ConnectorTaskResult => ({
  items: [item('Personal'), item('Work')],
  sources: [{ ...identity('Personal'), truncated: false }, { ...identity('Work'), truncated: true }],
  supported: [{ toolkitId: 'todoist', providerLabel: 'Todoist' }],
  failures: [{ ...identity('Work'), error: 'A later page failed' }],
});

describe('connector task launcher integration', () => {
  it('groups accounts independently while preserving a single provider scope', () => {
    const data = result();
    const groups = connectorTaskGroups(data, state);
    expect(groups.map((group) => [group.id, group.label, group.error, group.truncated])).toEqual([
      ['connector:todoist:Personal', 'Todoist · Personal', null, false],
      ['connector:todoist:Work', 'Todoist · Work', 'A later page failed', true],
    ]);
    expect(groups.map((group) => group.items.map((row) => row.key))).toEqual([
      ['todoist:Personal:same'], ['todoist:Work:same'],
    ]);
    expect(connectorProviderScopes(data)).toEqual([{ toolkitId: 'todoist', providerLabel: 'Todoist' }]);
  });

  it('preserves both selected accounts, their original bodies and source links through composed context', () => {
    const rows = connectorTaskGroups(result(), state).flatMap((group) => group.items);
    const chips = applyPick(applyPick([], rows[0]), rows[1]);
    expect(chips).toHaveLength(2);
    expect(applyPick(chips, rows[0])).toHaveLength(2);
    const prompt = composePrompt('Do these tasks', chips);
    for (const account of ['Personal', 'Work']) {
      expect(prompt).toContain(`Task details for ${account}`);
      expect(prompt).toContain(`Account: ${account}`);
      expect(prompt).toContain(`Connection ID: ${account}`);
      expect(prompt).toContain(`Account ID: user-${account}`);
    }
    expect(prompt.match(/Source: https:\/\/app.todoist.com\/app\/task\/same/g)).toHaveLength(2);
    expect(rows[0].body).toBe('Task details for Personal');
  });

  it('retains empty failed accounts and does not spread a failure to a successful account', () => {
    const data = result();
    data.items = [item('Personal')];
    const groups = connectorTaskGroups(data, state);
    expect(groups).toHaveLength(2);
    expect(groups[0].error).toBeNull();
    expect(groups[1].items).toEqual([]);
    expect(groups[1].error).toBe('A later page failed');
  });

  it('uses the provider label for one account and preserves loading state before discovery', () => {
    const data = result();
    data.sources = data.sources.slice(0, 1);
    expect(connectorTaskGroups(data, state)[0].label).toBe('Todoist');
    expect(connectorTaskGroups(undefined, { ...state, isLoading: true })[0].id).toBe('connector:loading');
    expect(connectorTaskGroups(undefined, state)).toEqual([]);
  });
});
