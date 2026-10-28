import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/queries', () => ({ getUserState: () => ({ timezone: 'America/Denver' }) }));

import { renderScheduleBuilderBrief } from './builder-brief';

describe('renderScheduleBuilderBrief', () => {
  it('sets up a new schedule in the user\'s timezone, never targeting itself', () => {
    const brief = renderScheduleBuilderBrief('new');
    expect(brief).toContain('Setting up a new schedule');
    expect(brief).toContain('create_trigger');
    expect(brief).toContain('America/Denver');
    expect(brief).toContain('Always pass the chat\'s id here');
    expect(brief).not.toContain('trigger id "new"');
  });

  it('works on one existing schedule, read live before each change', () => {
    const brief = renderScheduleBuilderBrief('0199-abc');
    expect(brief).toContain('Working on one schedule');
    expect(brief).toContain('`get_trigger` (id "0199-abc")');
    expect(brief).toContain('update_trigger');
  });
});
