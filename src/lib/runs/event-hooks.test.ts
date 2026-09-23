import { describe, expect, it, vi } from 'vitest';

vi.mock('@agentex/agent', () => ({}));

describe('summarizeText', () => {
  it('drops entity references and markdown, keeping one plain line', async () => {
    const { summarizeText } = await import('./event-hooks');
    const text =
      'Checked everything.\n\n**Did**\n\nSet the area on two tasks.\n\n[[task:01a0a609-a973-7dec-a5fa-ecee9c79357a]]\n\n' +
      '**Needs you**\n\nThe login agent is waiting.\n\n[[execution:01a0cbf0-11b7-7e2a-8c83-077556fea4da]]';
    expect(summarizeText(text)).toBe(
      'Checked everything. Did Set the area on two tasks. Needs you The login agent is waiting.',
    );
  });

  it('truncates past 200 characters', async () => {
    const { summarizeText } = await import('./event-hooks');
    const out = summarizeText('word '.repeat(100));
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith('…')).toBe(true);
  });
});
