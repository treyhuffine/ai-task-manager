import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const executeMock = vi.fn();
const capabilities = { mcp: true };
vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ execute: executeMock, capabilities }),
}));

let userState: { defaultHarness?: string | null; defaultModel?: string | null; workResultGuidance?: string | null } | undefined;
vi.mock('@/lib/db/queries', () => ({
  getUserState: () => userState,
}));

// What the installed CLI offers from each harness's cheap-model list. The real
// lookup runs live discovery, so the seam is the whole function.
let cheapModels: Record<string, string | undefined>;
vi.mock('@/lib/harness/model-discovery', () => ({
  cheapModelFor: async (providerId: string) => cheapModels[providerId],
}));

beforeEach(() => {
  executeMock.mockReset();
  executeMock.mockResolvedValue({ status: 'completed', summary: 'ok' });
  userState = undefined;
  cheapModels = { claude: 'haiku', codex: 'gpt-6-luna' };
  capabilities.mcp = true;
});

function lastCall() {
  return executeMock.mock.calls[executeMock.mock.calls.length - 1][0];
}

describe('resolveBackgroundHarness / backgroundModelFor', () => {
  it('defaults to Codex with the cheap model on the fast tier', async () => {
    const { resolveBackgroundHarness, backgroundModelFor } = await import('./one-shot');
    expect(resolveBackgroundHarness()).toBe('codex');
    expect(await backgroundModelFor('claude', 'fast')).toBe('haiku');
    expect(await backgroundModelFor('codex', 'fast')).toBe('gpt-6-luna');
  });

  it('fast tier falls back to the user model, never a dead id, when no cheap model is offered', async () => {
    // An install that lists none of the cheap candidates: sending one anyway
    // is the provider error this replaced (gpt-5.4-mini after its retirement).
    cheapModels = { codex: undefined };
    userState = { defaultHarness: 'codex', defaultModel: 'gpt-6-astra' };
    const { backgroundModelFor, runHarnessText } = await import('./one-shot');
    expect(await backgroundModelFor('codex', 'fast')).toBe('gpt-6-astra');
    await runHarnessText({ label: 't', prompt: 'x', tier: 'fast' });
    expect(lastCall().model).toBe('gpt-6-astra');

    // With no usable default either, the CLI picks its own.
    userState = { defaultHarness: 'codex' };
    expect(await backgroundModelFor('codex', 'fast')).toBeUndefined();
  });

  it('preserves a saved Claude default', async () => {
    userState = { defaultHarness: 'claude' };
    const { resolveBackgroundHarness } = await import('./one-shot');
    expect(resolveBackgroundHarness()).toBe('claude');
  });

  it('standard tier trusts the default model only when it belongs to the provider', async () => {
    const { backgroundModelFor } = await import('./one-shot');
    const { modelsForProvider } = await import('@/lib/harness/options');
    const claudeModel = modelsForProvider('claude')[0].id;

    userState = { defaultModel: claudeModel };
    expect(await backgroundModelFor('claude', 'standard')).toBe(claudeModel);

    // Cross-provider leftovers (stale state) fall back to the CLI default.
    userState = { defaultModel: 'gpt-6-luna' };
    expect(await backgroundModelFor('claude', 'standard')).toBeUndefined();
  });

  it('leaves Antigravity on its CLI default rather than pinning a slug that can retire', async () => {
    const { backgroundModelFor } = await import('./one-shot');
    userState = { defaultHarness: 'antigravity', defaultModel: 'gemini-3.1-pro-high' };
    // No stable cheap alias exists, so the fast tier sends no `--model`.
    expect(await backgroundModelFor('antigravity', 'fast')).toBeUndefined();
    // With no bundled catalog to vouch for it, a stored id is not sent either:
    // a stale cross-harness id (`opus`) would otherwise reach `agy`.
    expect(await backgroundModelFor('antigravity', 'standard')).toBeUndefined();
    userState = { defaultHarness: 'antigravity', defaultModel: 'opus' };
    expect(await backgroundModelFor('antigravity', 'standard')).toBeUndefined();
  });

  it('refuses Antigravity background calls while its CLI ignores required restrictions', async () => {
    userState = { defaultHarness: 'antigravity' };
    const { runHarnessText } = await import('./one-shot');
    await expect(runHarnessText({ label: 'deck', prompt: 'ASK' })).rejects.toThrow(
      /Antigravity background calls are unavailable.*tool restrictions and MCP isolation/,
    );
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('refuses a saved default whose rollout flag was switched off', async () => {
    userState = { defaultHarness: 'antigravity' };
    const { runHarnessText } = await import('./one-shot');
    vi.stubEnv('NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED', 'false');
    try {
      await expect(runHarnessText({ label: 'deck', prompt: 'ASK' })).rejects.toThrow(/disabled by the rollout configuration/);
      expect(executeMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('runHarnessText', () => {
  it('forwards qualified host flags and refuses a different saved harness', async () => {
    userState = { defaultHarness: 'claude' };
    const { runHarnessText } = await import('./one-shot');
    const extraArgs = ['--tools', '', '--no-session-persistence'];
    await runHarnessText({ label: 'demo', prompt: 'x', requiredHarness: 'claude', extraArgs });
    expect(lastCall().config.extraArgs).toEqual(extraArgs);
    executeMock.mockClear();
    userState = { defaultHarness: 'codex' };
    await expect(runHarnessText({ label: 'demo', prompt: 'x', requiredHarness: 'claude', extraArgs })).rejects.toThrow('requires the configured claude harness');
    expect(executeMock).not.toHaveBeenCalled();
  });
  it('returns the trimmed summary and folds system into the prompt', async () => {
    executeMock.mockResolvedValue({ status: 'completed', summary: '  the answer  ' });
    const { runHarnessText } = await import('./one-shot');
    const result = await runHarnessText({ label: 't', system: 'SYS', prompt: 'ASK' });
    expect(result.text).toBe('the answer');
    expect(lastCall().prompt).toBe('SYS\n\n---\n\nASK');
  });

  it('tool-less calls skip permissions with strict MCP and no Bash', async () => {
    const { runHarnessText } = await import('./one-shot');
    await runHarnessText({ label: 't', prompt: 'x' });
    const { config } = lastCall();
    expect(config.skipPermissions).toBe(true);
    expect(config.strictMcpConfig).toBe(true);
    expect(config.maxTurns).toBe(1);
    expect(config.disallowedTools).toContain('Bash');
    expect(config.mcpServers).toBeUndefined();
  });

  it('MCP-attached calls deny unattended instead of skipping permissions', async () => {
    const { runHarnessText } = await import('./one-shot');
    const server = { name: 'orchestrator', type: 'http' as const, url: 'http://localhost:1/mcp' };
    await runHarnessText({
      label: 't',
      prompt: 'x',
      maxTurns: 5,
      mcpServers: [server],
      allowedTools: ['mcp__orchestrator__search'],
    });
    const { config } = lastCall();
    expect(config.skipPermissions).toBeUndefined();
    expect(config.unattendedPermissionPolicy).toBe('deny');
    expect(config.mcpServers).toEqual([server]);
    expect(config.allowedTools).toEqual(['mcp__orchestrator__search']);
    expect(config.maxTurns).toBe(5);
  });

  it('explicit model wins over tier resolution', async () => {
    const { runHarnessText } = await import('./one-shot');
    await runHarnessText({ label: 't', prompt: 'x', tier: 'fast', model: 'opus' });
    expect(lastCall().model).toBe('opus');
  });

  it('throws on non-completed status and on empty output', async () => {
    const { runHarnessText } = await import('./one-shot');
    executeMock.mockResolvedValue({ status: 'timeout', summary: null, errorMessage: 'took too long' });
    await expect(runHarnessText({ label: 't', prompt: 'x' })).rejects.toThrow(/timeout.*took too long/);
    executeMock.mockResolvedValue({ status: 'completed', summary: '   ' });
    await expect(runHarnessText({ label: 't', prompt: 'x' })).rejects.toThrow(/no output/);
  });
});

describe('harnessSupportsMcp', () => {
  it('mirrors the provider capability flag', async () => {
    const { harnessSupportsMcp } = await import('./one-shot');
    expect(harnessSupportsMcp('claude')).toBe(true);
    capabilities.mcp = false;
    expect(harnessSupportsMcp('claude')).toBe(false);
  });
});

describe('extractJsonObject', () => {
  it('parses bare, fenced, and prose-wrapped objects', async () => {
    const { extractJsonObject } = await import('./one-shot');
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('Sure, here you go: {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
  });

  it('throws when no object is present', async () => {
    const { extractJsonObject } = await import('./one-shot');
    expect(() => extractJsonObject('no json here')).toThrow(/no JSON object/);
  });
});

describe('runHarnessJson', () => {
  const schema = z.object({ verdict: z.enum(['yes', 'no']) });
  const shape = '{"verdict": "yes" | "no"}';

  it('parses and validates a good reply', async () => {
    executeMock.mockResolvedValue({ status: 'completed', summary: '{"verdict":"yes"}' });
    const { runHarnessJson } = await import('./one-shot');
    const out = await runHarnessJson({ label: 't', prompt: 'x', schema, shape });
    expect(out).toEqual({ verdict: 'yes' });
    expect(lastCall().prompt).toContain(shape);
  });

  it('retries once with the rejection reason, then succeeds', async () => {
    executeMock
      .mockResolvedValueOnce({ status: 'completed', summary: 'not json at all' })
      .mockResolvedValueOnce({ status: 'completed', summary: '{"verdict":"no"}' });
    const { runHarnessJson } = await import('./one-shot');
    const out = await runHarnessJson({ label: 't', prompt: 'x', schema, shape });
    expect(out).toEqual({ verdict: 'no' });
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(lastCall().prompt).toContain('previous reply was rejected');
  });

  it('gives up after two failed attempts', async () => {
    executeMock.mockResolvedValue({ status: 'completed', summary: '{"verdict":"maybe"}' });
    const { runHarnessJson } = await import('./one-shot');
    await expect(runHarnessJson({ label: 't', prompt: 'x', schema, shape })).rejects.toThrow(
      /structured output failed after 2 attempts/,
    );
    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});


it.each(['claude', 'codex', 'cursor', 'opencode', 'antigravity'] as const)('keeps scoped handoff preferences out of %s one-shot calls', async (harness) => {
  userState = { defaultHarness: harness, workResultGuidance: 'HANDOFF_ONLY_HINT' };
  const { runHarnessText } = await import('./one-shot');
  if (harness === 'antigravity') {
    await expect(runHarnessText({ label: 'test', system: 'SYSTEM', prompt: 'REQUEST' })).rejects.toThrow(/background calls are unavailable/);
    expect(executeMock).not.toHaveBeenCalled();
    return;
  }
  await runHarnessText({ label: 'test', system: 'SYSTEM', prompt: 'REQUEST' });
  expect(lastCall().prompt).toBe('SYSTEM\n\n---\n\nREQUEST');
  expect(lastCall().prompt).not.toContain('get_handoff_context');
});
