import { describe, expect, it } from 'vitest';
import { autoHarness, suggestedHarness, type HarnessReports } from './harness-pick';

function report(opts: { installed?: boolean; subscription?: boolean; apiKey?: boolean; bedrock?: boolean }) {
  return {
    binary: { installed: opts.installed ?? true },
    hasSubscription: !!opts.subscription,
    hasApiKey: !!opts.apiKey,
    hasBedrock: !!opts.bedrock,
  } as never;
}

describe('autoHarness', () => {
  it('sets up Claude Code on a subscription or Bedrock without asking', () => {
    expect(autoHarness({ claude: report({ subscription: true }) })).toBe('claude');
    expect(autoHarness({ claude: report({ bedrock: true }) })).toBe('claude');
  });

  it('falls to Codex on a subscription when Claude is not ready', () => {
    const reports: HarnessReports = { claude: report({ installed: false }), codex: report({ subscription: true }) };
    expect(autoHarness(reports)).toBe('codex');
  });

  it('asks when only an API key is there, since that bills per call', () => {
    expect(autoHarness({ claude: report({ apiKey: true }), codex: report({ apiKey: true }) })).toBeNull();
  });

  it('asks for Cursor and OpenCode, which need a model picked', () => {
    expect(autoHarness({ cursor: report({ subscription: true }), opencode: report({ subscription: true }) })).toBeNull();
  });

  it('asks when nothing is installed or the checks failed', () => {
    expect(autoHarness({})).toBeNull();
    expect(autoHarness({ claude: null, codex: null })).toBeNull();
  });
});

describe('suggestedHarness', () => {
  it('starts the picker on the first one installed', () => {
    expect(suggestedHarness({ claude: report({ installed: false }), codex: report({ installed: false }), cursor: report({}) })).toBe(
      'cursor',
    );
    expect(suggestedHarness({})).toBe('claude');
  });
});
