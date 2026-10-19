import { describe, expect, it } from 'vitest';
import { backgroundTaskOutcomePresentation } from './background-task-presentation';

describe('backgroundTaskOutcomePresentation', () => {
  it('distinguishes completion, failure, and interruption', () => {
    expect(backgroundTaskOutcomePresentation('completed')).toEqual({
      label: 'finished',
      tone: 'success',
    });
    expect(backgroundTaskOutcomePresentation('failed')).toEqual({
      label: 'failed',
      tone: 'failure',
    });
    expect(backgroundTaskOutcomePresentation('stopped')).toEqual({
      label: 'stopped',
      tone: 'stopped',
    });
    expect(backgroundTaskOutcomePresentation('killed')).toEqual({
      label: 'stopped',
      tone: 'stopped',
    });
  });

  it('uses neutral styling for malformed terminal rows without a status', () => {
    expect(backgroundTaskOutcomePresentation(null)).toEqual({
      label: 'finished',
      tone: 'neutral',
    });
  });
});
