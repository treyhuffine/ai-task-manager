import { describe, expect, it } from 'vitest';
import { Braces, Code2, Orbit, SquareTerminal, Terminal } from 'lucide-react';
import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import { harnessIcon } from './harness-connection-ui';

describe('harnessIcon', () => {
  it('draws each harness with the icon its registry entry names', () => {
    expect(harnessIcon('claude')).toBe(Terminal);
    expect(harnessIcon('codex')).toBe(Code2);
    expect(harnessIcon('cursor')).toBe(SquareTerminal);
    expect(harnessIcon('opencode')).toBe(Braces);
    expect(harnessIcon('antigravity')).toBe(Orbit);
  });

  it('gives every harness its own icon', () => {
    const icons = KNOWN_HARNESS_IDS.map(harnessIcon);
    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
