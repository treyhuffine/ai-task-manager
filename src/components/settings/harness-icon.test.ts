import { describe, expect, it } from 'vitest';
import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import { harnessLogo } from './harness-connection-ui';

describe('harnessLogo', () => {
  it('draws each harness with its own brand mark', () => {
    expect(harnessLogo('claude').title).toBe('Claude');
    expect(harnessLogo('codex').title).toBe('Codex');
    expect(harnessLogo('cursor').title).toBe('Cursor');
    expect(harnessLogo('opencode').title).toBe('OpenCode');
    expect(harnessLogo('antigravity').title).toBe('Antigravity');
  });

  it('gives every harness a distinct, drawable mark and a brand color', () => {
    const logos = KNOWN_HARNESS_IDS.map(harnessLogo);
    expect(new Set(logos.map((logo) => logo.path)).size).toBe(logos.length);
    for (const logo of logos) {
      expect(logo.path).toMatch(/^[Mm][MmLlHhVvCcSsQqTtAaZz0-9 ,.\-e]+$/);
      expect(logo.hex).toMatch(/^[0-9A-F]{6}$/i);
    }
  });
});
