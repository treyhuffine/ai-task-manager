import { describe, expect, it } from 'vitest';
import { agentInitials } from './agent-initials';

/** The fallback an agent shows with no image or emoji (src/components/agents/agent-icon.tsx). */
describe('agentInitials', () => {
  it('takes the first letter of a one-word name', () => {
    expect(agentInitials('agentex')).toBe('A');
    expect(agentInitials('WhereAt')).toBe('W');
  });

  it('takes the first letters of the first two words, folder names included', () => {
    expect(agentInitials('Market Standard')).toBe('MS');
    expect(agentInitials('insiderfinance-tradedata')).toBe('IT');
    expect(agentInitials('insiderfinance-fmp-rebuild')).toBe('IF');
    expect(agentInitials('beamd_web')).toBe('BW');
  });

  it('skips punctuation and symbols to reach a letter or number', () => {
    expect(agentInitials('  (old) notes ')).toBe('ON');
    expect(agentInitials('#ops 2026')).toBe('O2');
    expect(agentInitials('éclair')).toBe('É');
  });

  it('shows a dot when the name has no letters or numbers', () => {
    expect(agentInitials('')).toBe('·');
    expect(agentInitials(' -- ')).toBe('·');
    expect(agentInitials('🔥')).toBe('·');
  });
});
