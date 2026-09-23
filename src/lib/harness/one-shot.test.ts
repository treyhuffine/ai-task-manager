import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const executeMock = vi.fn();
const capabilities = { mcp: true };
vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ execute: executeMock, capabilities }),
}));

let userState: { defaultHarness?: string | null; defaultModel?: string | null } | undefined;
vi.mock('@/lib/db/queries', () => ({
  getUserState: () => userState,
}));

beforeEach(() => {
  executeMock.mockReset();
  executeMock.mockResolvedValue({ status: 'completed', summary: 'ok' });
  userState = undefined;
  capabilities.mcp = true;
});

function lastCall() {
  return executeMock.mock.calls[executeMock.mock.calls.length - 1][0];
}

describe('resolveBackgroundHarness / backgroundModelFor', () => {
  it('defaults to claude with the cheap alias on the fast tier', async () => {
    const { resolveBackgroundHarness, backgroundModelFor } = await import('./one-shot');
    expect(resolveBackgroundHarness()).toBe('claude');
    expect(backgroundModelFor('claude', 'fast')).toBe('haiku');
    expect(backgroundModelFor('codex', 'fast')).toBe('gpt-5.4-mini');
  });

  it('follows the user default harness from user state', async () => {
    userState = { defaultHarness: 'codex' };
    const { resolveBackgroundHarness } = await import('./one-shot');
    expect(resolveBackgroundHarness()).toBe('codex');
  });

  it('standard tier trusts the default model only when it belongs to the provider', async () => {
    const { backgroundModelFor } = await import('./one-shot');
    const { modelsForProvider } = await import('@/lib/harness/options');
    const claudeModel = modelsForProvider('claude')[0].id;

    userState = { defaultModel: claudeModel };
    expect(backgroundModelFor('claude', 'standard')).toBe(claudeModel);

    // Cross-provider leftovers (stale state) fall back to the CLI default.
    userState = { defaultModel: 'gpt-5.4-mini' };
    expect(backgroundModelFor('claude', 'standard')).toBeUndefined();
  });
});

describe('runHarnessText', () => {
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
