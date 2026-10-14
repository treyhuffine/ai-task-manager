import { afterEach, expect, it, vi } from 'vitest';
const resolveAuth = vi.hoisted(() => vi.fn());
vi.mock('@agentex/agent', () => ({ getProvider: () => ({ resolveAuth }) }));
import { teamAiAuthEnv, teamAiSubscription } from './auth';
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it('uses native sign-in without forwarding API keys or changing the host environment', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'ambient-api-key');
  vi.stubEnv('OPENAI_API_KEY', 'other-provider-key');
  vi.stubEnv('CLAUDE_CONFIG_DIR', '/host/claude-account');
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'test-oauth');
  vi.stubEnv('CLAUDE_COMMAND', '/host/bin/claude');
  resolveAuth.mockResolvedValue({ source: 'cli', binary: { installed: true }, options: [{ method: 'subscription', present: true }] });
  expect(await teamAiSubscription(true)).toEqual({ available: true });
  expect(resolveAuth).toHaveBeenCalledWith({ fresh: true, command: '/host/bin/claude', env: expect.objectContaining({
    CLAUDE_CONFIG_DIR: '/host/claude-account', CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', OPENAI_API_KEY: '',
  }) });
  expect(process.env.ANTHROPIC_API_KEY).toBe('ambient-api-key');
  expect(teamAiAuthEnv().CLAUDE_CODE_OAUTH_TOKEN).toBe('test-oauth');
});

it.each([
  { source: 'cli', binary: { installed: true }, options: [{ method: 'api_key', present: true }] },
  { source: 'filesystem', binary: { installed: true }, options: [{ method: 'subscription', present: true }] },
  { source: 'cli', binary: { installed: false }, options: [{ method: 'subscription', present: true }] },
  { source: 'cli', binary: { installed: true }, options: [{ method: 'subscription', present: false }] },
])('requires a CLI-confirmed subscription, not merely an API key or a credential file: %j', async report => {
  resolveAuth.mockResolvedValue(report);
  expect(await teamAiSubscription()).toEqual({ available: false });
});

it('reports failed discovery as unavailable without returning host errors or secrets', async () => {
  resolveAuth.mockRejectedValue(new Error('private native failure'));
  expect(await teamAiSubscription()).toEqual({ available: false });
});

it('preserves an unset config directory so Claude uses its existing default keychain namespace', () => {
  vi.stubEnv('CLAUDE_CONFIG_DIR', undefined);
  const env = teamAiAuthEnv();
  expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR');
  expect(env.HOME).toBe(process.env.HOME);
});
