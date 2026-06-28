import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConnectorRuntime: vi.fn(),
  getConnectorTools: vi.fn(),
}));

vi.mock('@/lib/connectors/runtime', () => ({
  getConnectorOwnerId: () => 'local',
  getConnectorRuntime: mocks.getConnectorRuntime,
  getConnectorTools: mocks.getConnectorTools,
}));

import { getReadOnlyConnectorTools } from './connector-tools';

beforeEach(() => {
  mocks.getConnectorRuntime.mockReset();
  mocks.getConnectorTools.mockReset();
});

describe('getReadOnlyConnectorTools', () => {
  it('keeps non-mutating tools and drops mutating ones', async () => {
    mocks.getConnectorRuntime.mockResolvedValue({
      listConnections: async () => [{ id: 'c1', providerId: 'google' }],
      getToolkits: () => [
        {
          id: 'google_calendar',
          providerId: 'google',
          actions: [
            { id: 'google_calendar.list_events', mutating: false },
            { id: 'google_calendar.list_calendars' }, // undefined mutating → read
            { id: 'google_calendar.create_event', mutating: true }, // write → drop
          ],
        },
      ],
    });
    mocks.getConnectorTools.mockResolvedValue({
      google_calendar__list_events: { description: 'read' },
      google_calendar__list_calendars: { description: 'read' },
      google_calendar__create_event: { description: 'write' },
    });

    const tools = await getReadOnlyConnectorTools('local');
    expect(Object.keys(tools).sort()).toEqual([
      'google_calendar__list_calendars',
      'google_calendar__list_events',
    ]);
    expect(tools).not.toHaveProperty('google_calendar__create_event');
  });

  it('drops tools whose provider is not connected', async () => {
    mocks.getConnectorRuntime.mockResolvedValue({
      listConnections: async () => [{ id: 'c1', providerId: 'google' }], // linear NOT connected
      getToolkits: () => [
        { id: 'google_calendar', providerId: 'google', actions: [{ id: 'google_calendar.list_events', mutating: false }] },
        { id: 'linear', providerId: 'linear', actions: [{ id: 'linear.list_issues', mutating: false }] },
      ],
    });
    mocks.getConnectorTools.mockResolvedValue({
      google_calendar__list_events: {},
      linear__list_issues: {},
    });

    const tools = await getReadOnlyConnectorTools('local');
    expect(Object.keys(tools)).toEqual(['google_calendar__list_events']);
  });

  it('returns {} when nothing is connected', async () => {
    mocks.getConnectorRuntime.mockResolvedValue({
      listConnections: async () => [],
      getToolkits: () => [],
    });
    expect(await getReadOnlyConnectorTools('local')).toEqual({});
  });

  it('returns {} and never throws when the runtime errors', async () => {
    mocks.getConnectorRuntime.mockRejectedValue(new Error('boom'));
    expect(await getReadOnlyConnectorTools('local')).toEqual({});
  });
});
