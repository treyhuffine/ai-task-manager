import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoHarness, suggestedHarness, type HarnessReports } from './harness-pick';
import { DEFAULT_HARNESS, HARNESS_IDS } from '@/lib/harness/registry';

function report(opts: { installed?: boolean; subscription?: boolean; apiKey?: boolean; bedrock?: boolean }) {
  return {
    binary: { installed: opts.installed ?? true },
    hasSubscription: !!opts.subscription,
    hasApiKey: !!opts.apiKey,
    hasBedrock: !!opts.bedrock,
  } as never;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('autoHarness', () => {
  it('prefers Codex when both subscriptions are ready', () => {
    const reports: HarnessReports = {
      claude: report({ subscription: true }),
      codex: report({ subscription: true }),
    };
    expect(autoHarness(reports)).toBe('codex');
    expect(autoHarness({ ...reports, claude: report({ bedrock: true }) })).toBe('codex');
  });

  it('sets up Claude Code on a subscription or Bedrock when Codex is not ready', () => {
    expect(autoHarness({ claude: report({ subscription: true }) })).toBe('claude');
    expect(autoHarness({ claude: report({ bedrock: true }), codex: report({ installed: false, subscription: true }) })).toBe('claude');
    expect(autoHarness({ claude: report({ subscription: true }), codex: report({ apiKey: true }) })).toBe('claude');
  });

  it('sets up Codex on a subscription when Claude is not ready', () => {
    const reports: HarnessReports = { claude: report({ installed: false }), codex: report({ subscription: true }) };
    expect(autoHarness(reports)).toBe('codex');
  });

  it('asks when only an API key is there, since that bills per call', () => {
    expect(autoHarness({ claude: report({ apiKey: true }), codex: report({ apiKey: true }) })).toBeNull();
  });

  it('asks for Cursor, OpenCode and Antigravity, which need a model picked', () => {
    expect(autoHarness({ cursor: report({ subscription: true }), opencode: report({ subscription: true }) })).toBeNull();
    expect(autoHarness({ antigravity: report({ subscription: true }) })).toBeNull();
  });

  it('asks when nothing is installed or the checks failed', () => {
    expect(autoHarness({})).toBeNull();
    expect(autoHarness({ claude: null, codex: null })).toBeNull();
    expect(autoHarness({ claude: report({ installed: false, subscription: true }), codex: report({ installed: false, subscription: true }) })).toBeNull();
  });
});

describe('suggestedHarness', () => {
  it('prefers Codex when both Codex and Claude are installed', () => {
    expect(suggestedHarness({ claude: report({}), codex: report({}) })).toBe('codex');
  });

  it('starts the picker on the first one installed', () => {
    expect(suggestedHarness({ claude: report({ installed: false }), codex: report({ installed: false }), cursor: report({}) })).toBe(
      'cursor',
    );
    expect(suggestedHarness({})).toBe(DEFAULT_HARNESS);
  });

  it('suggests Antigravity when it is the only CLI installed', () => {
    expect(suggestedHarness({ claude: report({ installed: false }), antigravity: report({}) })).toBe('antigravity');
  });

  it('uses registry order for every enabled harness', () => {
    for (let index = 0; index < HARNESS_IDS.length; index++) {
      const reports = Object.fromEntries(HARNESS_IDS.slice(index).map((id) => [id, report({})]));
      expect(suggestedHarness(reports)).toBe(HARNESS_IDS[index]);
    }
  });

  it('ignores installed harnesses hidden by rollout flags', async () => {
    vi.stubEnv('NEXT_PUBLIC_RI_CURSOR_ENABLED', 'false');
    vi.stubEnv('NEXT_PUBLIC_RI_OPENCODE_ENABLED', 'false');
    vi.stubEnv('NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED', 'false');
    vi.resetModules();
    const picks = await import('./harness-pick');
    const reports: HarnessReports = {
      cursor: report({ subscription: true }),
      opencode: report({ subscription: true }),
      antigravity: report({ subscription: true }),
    };
    expect(picks.suggestedHarness(reports)).toBe(DEFAULT_HARNESS);
    expect(picks.autoHarness(reports)).toBeNull();
  });
});
