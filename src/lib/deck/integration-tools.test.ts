import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getIntegrationRuntime: vi.fn(),
  getIntegrationTools: vi.fn(),
}));

vi.mock('@/lib/integrations/runtime', () => ({
  getIntegrationOwnerId: () => 'local',
  getIntegrationRuntime: mocks.getIntegrationRuntime,
  getIntegrationTools: mocks.getIntegrationTools,
}));

import { getReadOnlyIntegrationTools } from './integration-tools';

beforeEach(() => {
  mocks.getIntegrationRuntime.mockReset();
  mocks.getIntegrationTools.mockReset();
});

describe('getReadOnlyIntegrationTools', () => {
  it('keeps non-mutating tools and drops mutating ones', async () => {
    mocks.getIntegrationRuntime.mockResolvedValue({
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
    mocks.getIntegrationTools.mockResolvedValue({
      google_calendar__list_events: { description: 'read' },
      google_calendar__list_calendars: { description: 'read' },
      google_calendar__create_event: { description: 'write' },
    });

    const tools = await getReadOnlyIntegrationTools('local');
    expect(Object.keys(tools).sort()).toEqual([
      'google_calendar__list_calendars',
      'google_calendar__list_events',
    ]);
    expect(tools).not.toHaveProperty('google_calendar__create_event');
  });

  it('drops tools whose provider is not connected', async () => {
    mocks.getIntegrationRuntime.mockResolvedValue({
      listConnections: async () => [{ id: 'c1', providerId: 'google' }], // Atlassian is not connected.
      getToolkits: () => [
        { id: 'google_calendar', providerId: 'google', actions: [{ id: 'google_calendar.list_events', mutating: false }] },
        { id: 'atlassian', providerId: 'atlassian', actions: [{ id: 'atlassian.searchJiraIssuesUsingJql', mutating: false }] },
      ],
    });
    mocks.getIntegrationTools.mockResolvedValue({
      google_calendar__list_events: {},
      atlassian__searchJiraIssuesUsingJql: {},
    });

    const tools = await getReadOnlyIntegrationTools('local');
    expect(Object.keys(tools)).toEqual(['google_calendar__list_events']);
  });

  it('returns {} when nothing is connected', async () => {
    mocks.getIntegrationRuntime.mockResolvedValue({
      listConnections: async () => [],
      getToolkits: () => [],
    });
    expect(await getReadOnlyIntegrationTools('local')).toEqual({});
  });

  it('returns {} and never throws when the runtime errors', async () => {
    mocks.getIntegrationRuntime.mockRejectedValue(new Error('boom'));
    expect(await getReadOnlyIntegrationTools('local')).toEqual({});
  });
});
