import { describe, expect, it, vi } from 'vitest';
import { cachedGithubTokens, connectorGithubTokens, ghAuthToken, GITHUB_TOKEN_CACHE_MS, githubTokens } from './credentials';

describe('githubTokens', () => {
  it('puts the host’s gh sign-in first, then connected GitHub accounts, each once', async () => {
    const tokens = await githubTokens({ gh: async () => 'gh-tok', connectors: async () => ['work', 'gh-tok', 'personal', 'work'] });
    expect(tokens).toEqual(['gh-tok', 'work', 'personal']);
  });

  it('is empty when the home has no credential, and never throws', async () => {
    expect(await githubTokens({ gh: async () => null, connectors: async () => [] })).toEqual([]);
    expect(await githubTokens({ gh: async () => { throw new Error('no gh'); }, connectors: async () => { throw new Error('no store'); } })).toEqual([]);
    expect(await githubTokens({ gh: async () => { throw new Error('no gh'); }, connectors: async () => ['work'] })).toEqual(['work']);
  });

  it('remembers the answer for a minute so a page of images asks once', async () => {
    let now = 5_000_000;
    const gh = vi.fn(async () => `tok-${gh.mock.calls.length}`);
    const sources = { gh, connectors: async () => [], now: () => now };
    expect(await cachedGithubTokens(sources)).toEqual(['tok-1']);
    expect(await cachedGithubTokens(sources)).toEqual(['tok-1']);
    expect(gh).toHaveBeenCalledTimes(1);
    now += GITHUB_TOKEN_CACHE_MS;
    expect(await cachedGithubTokens(sources)).toEqual(['tok-2']);
    expect(gh).toHaveBeenCalledTimes(2);
  });
});

describe('ghAuthToken', () => {
  it('asks gh for the github.com token without ever prompting', async () => {
    const exec = vi.fn(async () => ({ stdout: 'gho_abc123\n' }));
    expect(await ghAuthToken(exec)).toBe('gho_abc123');
    const [file, args, options] = exec.mock.calls[0]! as unknown as [string, string[], { env: NodeJS.ProcessEnv; timeout: number }];
    expect(file).toBe('gh');
    expect(args).toEqual(['auth', 'token', '--hostname', 'github.com']);
    expect(options.env.GH_PROMPT_DISABLED).toBe('1');
    expect(options.timeout).toBeGreaterThan(0);
  });

  it('is null when gh is missing, signed out, or says something that is not a token', async () => {
    expect(await ghAuthToken(async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); })).toBeNull();
    expect(await ghAuthToken(async () => { throw Object.assign(new Error('exit 1'), { code: 1, stderr: 'no oauth token' }); })).toBeNull();
    expect(await ghAuthToken(async () => ({ stdout: '' }))).toBeNull();
    expect(await ghAuthToken(async () => ({ stdout: 'not a token\n' }))).toBeNull();
  });
});

describe('connectorGithubTokens', () => {
  it('opens the token of each enabled GitHub connector and nothing else', async () => {
    const opened: string[] = [];
    const store = async () => ({
      list: () => [
        { id: 'gh-1', providerId: 'github', enabled: true, auth: { kind: 'bearer' } },
        { id: 'gh-off', providerId: 'github', enabled: false, auth: { kind: 'bearer' } },
        { id: 'gh-oauth', providerId: 'github', enabled: true, auth: { kind: 'oauth' } },
        { id: 'linear', providerId: 'linear', enabled: true, auth: { kind: 'bearer' } },
        { id: 'custom', providerId: null, enabled: true, auth: { kind: 'bearer' } },
        { id: 'gh-2', providerId: 'github', enabled: true, auth: { kind: 'bearer' } },
        { id: 'gh-empty', providerId: 'github', enabled: true, auth: { kind: 'bearer' } },
      ],
      openSecret: async (id: string) => { opened.push(id); return id === 'gh-empty' ? null : `secret-${id}`; },
    });
    expect(await connectorGithubTokens(store)).toEqual(['secret-gh-1', 'secret-gh-2']);
    expect(opened).toEqual(['gh-1', 'gh-2', 'gh-empty']);
  });

  it('is empty when the store cannot be opened', async () => {
    expect(await connectorGithubTokens(async () => { throw new Error('locked'); })).toEqual([]);
  });
});
