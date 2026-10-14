/**
 * The team AI's launch profile and turn credential (docs/homes-spec.md §9.9,
 * P8.4), exactly. The real binary's behavior under this profile is qualified
 * in runtime.harness.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { devProviderOverride, isAuthRefusal, isCredentialRejection, TEAM_AI_LAUNCH_ARGS, teamAiDirs, teamAiLaunch, teamAiMessage } from './runtime';
import type { StreamEvent } from '@agentex/agent';

let home: TestHome;
beforeEach(async () => { home = await createTestHome({ prefix: 'ri-team-ai-profile-', openDb: false }); });
afterEach(async () => { await home.cleanup(); });

describe('the launch profile', () => {
  it('keeps a turn to the team\'s tools, its own folders and the team\'s key', () => {
    const dirs = teamAiDirs('/srv/team/.work');
    const launch = teamAiLaunch({ turnToken: 'rtt_x.y', mcpUrl: 'http://127.0.0.1:4224/api/team/mcp', model: null, instructionsFile: '/srv/i.md', dirs });
    expect(TEAM_AI_LAUNCH_ARGS).not.toContain('--bare');
    expect(TEAM_AI_LAUNCH_ARGS).toContain('--no-session-persistence');
    const settings = JSON.parse(TEAM_AI_LAUNCH_ARGS[TEAM_AI_LAUNCH_ARGS.indexOf('--settings') + 1]);
    expect(settings).toMatchObject({ disableAllHooks: true, autoMemoryEnabled: false, claudeMdExcludes: ['**'], forceLoginMethod: 'claudeai' });
    expect(launch.cwd).toBe('/srv/team/.work/team-ai/runtime');
    expect(launch.config).toEqual({
      mcpServers: [{ name: 'ri_team', type: 'http', url: 'http://127.0.0.1:4224/api/team/mcp', headers: { Authorization: 'Bearer rtt_x.y' } }],
      strictMcpConfig: true,
      allowedTools: ['mcp__ri_team'],
      instructionsFile: '/srv/i.md',
      unattendedPermissionPolicy: 'deny',
      extraArgs: [...TEAM_AI_LAUNCH_ARGS],
    });
    expect(launch.env.HOME).toBe(process.env.HOME);
    expect(launch.env.CLAUDE_CONFIG_DIR).toBe(process.env.CLAUDE_CONFIG_DIR || undefined);
    expect(launch.env.ANTHROPIC_API_KEY).toBe('');
    expect(launch.env.ANTHROPIC_AUTH_TOKEN).toBe('');
    // The host's other provider keys never reach it.
    for (const name of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_PROFILE']) expect(launch.env[name], name).toBe('');
    expect(teamAiLaunch({ turnToken: 't', mcpUrl: 'u', model: 'claude-x', instructionsFile: 'f', dirs }).config.model).toBe('claude-x');
  });

  it('names who sent each message', () => {
    expect(teamAiMessage('Maya', 'What did we decide?')).toBe('Maya:\n\nWhat did we decide?');
  });

  it('takes a stand-in provider only in development, and only on this computer', () => {
    expect(devProviderOverride({ NODE_ENV: 'development', RI_TEAM_AI_DEV_PROVIDER_URL: 'http://127.0.0.1:9999/x' } as NodeJS.ProcessEnv)).toBe('http://127.0.0.1:9999');
    expect(devProviderOverride({ NODE_ENV: 'production', RI_TEAM_AI_DEV_PROVIDER_URL: 'http://127.0.0.1:9999' } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(devProviderOverride({ NODE_ENV: 'development', RI_TEAM_AI_DEV_PROVIDER_URL: 'https://api.example.com' } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(devProviderOverride({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe('a refused key', () => {
  it('is recognized at the first refusal, not after Claude Code\'s ten retries', () => {
    const retry = (raw: Record<string, unknown>) => ({ type: 'unknown', subtype: 'system', raw: { type: 'system', subtype: 'api_retry', ...raw } }) as unknown as StreamEvent;
    expect(isAuthRefusal(retry({ error: 'authentication_failed', error_status: 401 }))).toBe(true);
    expect(isAuthRefusal(retry({ error_status: 403 }))).toBe(true);
    expect(isAuthRefusal({ type: 'auth_required' } as unknown as StreamEvent)).toBe(true);
    // An overloaded provider is retried as usual.
    expect(isAuthRefusal(retry({ error: 'overloaded', error_status: 529 }))).toBe(false);
    expect(isAuthRefusal({ type: 'assistant', text: 'hi' } as unknown as StreamEvent)).toBe(false);
  });
});

describe('a failed turn\'s error', () => {
  it('counts as a refused key only when the error says so, never for what the turn talked about', () => {
    expect(isCredentialRejection({ errorCode: 'authentication_failed', errorMessage: null })).toBe(true);
    expect(isCredentialRejection({ errorCode: null, errorMessage: 'API Error: 401 invalid x-api-key' })).toBe(true);
    expect(isCredentialRejection({ errorCode: null, errorMessage: 'Not logged in · Please run /login' })).toBe(true);
    expect(isCredentialRejection({ errorCode: 'max_turns', errorMessage: 'Reached the turn limit while explaining the API key rotation and authentication flow' })).toBe(false);
    expect(isCredentialRejection({ errorCode: null, errorMessage: 'Overloaded' })).toBe(false);
  });
});

describe('the runtime probe', () => {
  it('finds every flag the profile needs, and names any that are missing', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { probeTeamAiRuntime } = await import('./probe');
    const script = (help: string) => {
      const file = path.join(home.root, `claude-${Math.random().toString(36).slice(2)}`);
      fs.writeFileSync(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; else printf '%s\\n' "${help}"; fi\n`, { mode: 0o755 });
      return file;
    };
    const all = '  --no-session-persistence  --settings <json>  --restricted  --tools <tools...>  --disable-slash-commands  --setting-sources <s>  --strict-mcp-config  --mcp-config <c>  --allowed-tools <t>';
    expect(await probeTeamAiRuntime({ command: script(all) })).toEqual({ ok: true, version: '9.9.9 (Claude Code)', missing: [], error: null });
    const older = await probeTeamAiRuntime({ command: script(all.replace('--restricted', '')) });
    expect(older).toMatchObject({ ok: false, missing: ['--restricted'] });
    expect(await probeTeamAiRuntime({ command: path.join(home.root, 'nothing-here') })).toMatchObject({ ok: false, version: null });
  });

  it('asks again soon after a failure, and holds a good answer for a while', async () => {
    const { probeStillFresh } = await import('./probe');
    const ok = { ok: true, version: 'x', missing: [], error: null };
    const failed = { ok: false, version: null, missing: [], error: 'slow' };
    expect(probeStillFresh(ok, 0, 9 * 60 * 1000)).toBe(true);
    expect(probeStillFresh(failed, 0, 31 * 1000)).toBe(false);
    expect(probeStillFresh(failed, 0, 10 * 1000)).toBe(true);
  });
});

describe('the turn credential', () => {
  it('is the team\'s own, names its turn, and stops at its expiry or any change', async () => {
    const { mintTurnToken, readTurnToken, TURN_TOKEN_TTL_MS } = await import('./turn-credential');
    const now = Date.now();
    const token = mintTurnToken({ turnId: 't1', chatId: 'c1', memberId: 'm1' }, now);
    expect(readTurnToken(token, now)).toEqual({ turnId: 't1', chatId: 'c1', memberId: 'm1', expiresAt: now + TURN_TOKEN_TTL_MS });
    expect(readTurnToken(token, now + TURN_TOKEN_TTL_MS)).toBeNull();
    const [payload, signature] = token.slice(4).split('.');
    const forged = Buffer.from(JSON.stringify({ t: 't1', c: 'c1', m: 'someone-else', e: now + TURN_TOKEN_TTL_MS })).toString('base64url');
    expect(readTurnToken(`rtt_${forged}.${signature}`, now)).toBeNull();
    expect(readTurnToken(`rtt_${payload}.${signature}x`, now)).toBeNull();
    expect(readTurnToken(`ri_live_${payload}.${signature}`, now)).toBeNull();
  });
});
