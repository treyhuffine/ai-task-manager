import { describe, expect, it } from 'vitest';
import {
  HARNESS_IDS,
  HARNESS_REGISTRY,
  isHarnessId,
  isKnownHarnessId,
  isHarnessEnabled,
  resumeCommandForHarness,
} from './registry';

describe('harness registry', () => {
  it('contains exactly the four product harnesses and no separate Grok harness', () => {
    expect(HARNESS_IDS).toEqual(['claude', 'codex', 'cursor', 'opencode']);
    expect(isHarnessId('grok')).toBe(false);
    expect(HARNESS_REGISTRY.cursor.description).toContain('Grok');
  });

  it('knows every stored harness id, rollout flag or not, and nothing else', () => {
    for (const id of ['claude', 'codex', 'cursor', 'opencode']) expect(isKnownHarnessId(id)).toBe(true);
    // The retired agents-table spelling is not a harness id anymore.
    expect(isKnownHarnessId('claude_code')).toBe(false);
    expect(isKnownHarnessId('unknown')).toBe(false);
    expect(isKnownHarnessId(undefined)).toBe(false);
  });

  it('keeps resume commands in registry metadata', () => {
    expect(resumeCommandForHarness('claude', 'claude-1')).toBe('claude --resume claude-1');
    expect(resumeCommandForHarness('claude_code', 'claude-1')).toBeNull();
    expect(resumeCommandForHarness('codex', 'codex-1')).toBe('codex resume codex-1');
    expect(resumeCommandForHarness('cursor', 'cursor-1')).toBe('agent --resume cursor-1');
    expect(resumeCommandForHarness('opencode', 'opencode-1')).toBeNull();
    expect(resumeCommandForHarness('unknown', 'session-1')).toBeNull();
  });

  it('supports independent emergency rollout switches for new harnesses', () => {
    const cursor = process.env.NEXT_PUBLIC_RI_CURSOR_ENABLED;
    const opencode = process.env.NEXT_PUBLIC_RI_OPENCODE_ENABLED;
    try {
      process.env.NEXT_PUBLIC_RI_CURSOR_ENABLED = 'false';
      process.env.NEXT_PUBLIC_RI_OPENCODE_ENABLED = 'false';
      expect(isHarnessEnabled('cursor')).toBe(false);
      expect(isHarnessEnabled('opencode')).toBe(false);
      expect(isHarnessEnabled('claude')).toBe(true);
      expect(isHarnessEnabled('codex')).toBe(true);
    } finally {
      if (cursor === undefined) delete process.env.NEXT_PUBLIC_RI_CURSOR_ENABLED;
      else process.env.NEXT_PUBLIC_RI_CURSOR_ENABLED = cursor;
      if (opencode === undefined) delete process.env.NEXT_PUBLIC_RI_OPENCODE_ENABLED;
      else process.env.NEXT_PUBLIC_RI_OPENCODE_ENABLED = opencode;
    }
  });

  it('declares conservative maximums for unsupported controls', () => {
    expect(HARNESS_REGISTRY.cursor.maximumCapabilities).toMatchObject({
      sessions: true,
      resume: true,
      modelDiscovery: true,
      reasoningEffort: false,
      permissionRequests: false,
      concurrentSend: false,
      stopTask: false,
      sessionModelChange: false,
    });
    expect(HARNESS_REGISTRY.opencode.maximumCapabilities).toMatchObject({
      durableCatchUp: true,
      modelDiscovery: true,
      upstreamProviderSetup: true,
      modelVariants: true,
      permissionRequests: true,
      stopTask: false,
    });
  });
});
