import { describe, expect, it } from 'vitest';
import {
  HARNESS_IDS,
  HARNESS_REGISTRY,
  KNOWN_HARNESS_IDS,
  isHarnessId,
  isKnownHarnessId,
  isHarnessEnabled,
  resumeCommandForHarness,
  type HarnessId,
} from './registry';

describe('harness registry', () => {
  it('contains exactly the five product harnesses and no separate Grok or Gemini harness', () => {
    expect(HARNESS_IDS).toEqual(['claude', 'codex', 'cursor', 'opencode', 'antigravity']);
    expect(KNOWN_HARNESS_IDS).toEqual(HARNESS_IDS);
    expect(isHarnessId('grok')).toBe(false);
    // Gemini CLI stopped serving Google accounts; Antigravity is the harness.
    expect(isHarnessId('gemini')).toBe(false);
    expect(HARNESS_REGISTRY.cursor.description).toContain('Grok');
  });

  it('maps every harness to its own agentex provider and its own icon', () => {
    for (const id of KNOWN_HARNESS_IDS) {
      expect(HARNESS_REGISTRY[id].id).toBe(id);
      expect(HARNESS_REGISTRY[id].agentexProviderId).toBe(id);
    }
    const icons = KNOWN_HARNESS_IDS.map((id) => HARNESS_REGISTRY[id].icon);
    // Claude keeps the plain terminal. Every other harness is told apart at a glance.
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('knows every stored harness id, rollout flag or not, and nothing else', () => {
    for (const id of ['claude', 'codex', 'cursor', 'opencode', 'antigravity']) expect(isKnownHarnessId(id)).toBe(true);
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
    expect(resumeCommandForHarness('antigravity', 'conv-1')).toBe('agy --conversation conv-1');
    expect(resumeCommandForHarness('unknown', 'session-1')).toBeNull();
  });

  it('supports independent emergency rollout switches for new harnesses', () => {
    const flags = {
      cursor: 'NEXT_PUBLIC_RI_CURSOR_ENABLED',
      opencode: 'NEXT_PUBLIC_RI_OPENCODE_ENABLED',
      antigravity: 'NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED',
    } as const satisfies Partial<Record<HarnessId, string>>;
    const saved = Object.values(flags).map((name) => [name, process.env[name]] as const);
    try {
      for (const name of Object.values(flags)) delete process.env[name];
      // On by default.
      for (const id of Object.keys(flags) as HarnessId[]) expect(isHarnessEnabled(id)).toBe(true);

      // Each switch turns off its own harness and nothing else.
      for (const [id, name] of Object.entries(flags) as Array<[HarnessId, string]>) {
        process.env[name] = 'false';
        expect(isHarnessEnabled(id)).toBe(false);
        for (const other of KNOWN_HARNESS_IDS.filter((entry) => entry !== id)) {
          expect(isHarnessEnabled(other)).toBe(true);
        }
        delete process.env[name];
      }

      // Only the exact string `false` switches one off.
      process.env.NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED = '0';
      expect(isHarnessEnabled('antigravity')).toBe(true);
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
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

  it('declares what Antigravity can do and nothing it cannot', () => {
    const antigravity = HARNESS_REGISTRY.antigravity;
    expect(antigravity).toMatchObject({
      name: 'Antigravity',
      loginCommand: 'agy',
      installHint: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
      docsUrl: 'https://antigravity.google/docs/cli/overview',
      // GEMINI_API_KEY alone does nothing without the CLI's settings change.
      apiKeyVar: null,
      icon: 'orbit',
    });
    expect(antigravity.maximumCapabilities).toEqual({
      sessions: true,
      resume: true,
      durableCatchUp: false,
      modelDiscovery: true,
      upstreamProviderSetup: false,
      upstreamProviderDisconnect: false,
      modelVariants: false,
      reasoningEffort: true,
      permissionRequests: false,
      questionRequests: false,
      planMode: true,
      modes: true,
      mcp: false,
      strictMcpIsolation: false,
      concurrentSend: false,
      cancelQueuedMessage: false,
      stopTask: false,
      sessionModelChange: false,
      sessionVariantChange: false,
      sessionEffortChange: false,
      sessionModeChange: false,
    });
  });

  it('never claims more than the agentex provider declares', async () => {
    const { getProvider } = await import('@agentex/agent');
    // Registry keys with a same-named agentex capability.
    const keys = [
      'sessions', 'resume', 'modelDiscovery', 'modelVariants', 'permissionRequests',
      'questionRequests', 'planMode', 'modes', 'mcp', 'concurrentSend', 'cancelQueuedMessage',
      'stopTask', 'sessionModelChange', 'sessionVariantChange', 'sessionEffortChange', 'sessionModeChange',
    ] as const;
    for (const id of KNOWN_HARNESS_IDS) {
      const declared = getProvider(HARNESS_REGISTRY[id].agentexProviderId).capabilities as unknown as Record<string, unknown>;
      for (const key of keys) {
        if (HARNESS_REGISTRY[id].maximumCapabilities[key]) {
          expect({ id, key, declared: declared[key] }).toEqual({ id, key, declared: true });
        }
      }
    }
  });
});
