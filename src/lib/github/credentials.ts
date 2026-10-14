/**
 * The user's GitHub credentials on the home, for reading what their account
 * can read: the host's `gh` sign-in first (what every GitHub feature here
 * already relies on), then any GitHub connector they connected in Settings.
 *
 * A token is only ever sent to GitHub (`src/lib/github/repo-image.ts`),
 * never logged, and never part of a reply to a browser. Resolving spawns a
 * process and opens sealed secrets, so one answer serves every image on a
 * page for a minute.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { processState } from '@/lib/process-state';
import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';

const execFileAsync = promisify(execFile);

export const GITHUB_TOKEN_CACHE_MS = 60_000;

export interface GithubTokenSources {
  /** The host's `gh auth token`, or null when gh is missing or signed out. */
  gh?: () => Promise<string | null>;
  /** Tokens of connected GitHub connectors. */
  connectors?: () => Promise<string[]>;
  now?: () => number;
}

/** Distinct credentials to try, in order. Empty when the home has none. */
export async function githubTokens(sources: GithubTokenSources = {}): Promise<string[]> {
  const gh = sources.gh ?? ghAuthToken;
  const connectors = sources.connectors ?? connectorGithubTokens;
  const [own, connected] = await Promise.all([gh().catch(() => null), connectors().catch(() => [])]);
  const tokens: string[] = [];
  for (const token of [own, ...connected]) {
    if (token && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

/** `githubTokens`, remembered for a minute so a page of images asks once. */
export function cachedGithubTokens(sources: GithubTokenSources = {}): Promise<string[]> {
  const now = sources.now ?? Date.now;
  const cache = processState('github.tokens', () => ({ at: 0, tokens: null as Promise<string[]> | null }));
  if (cache.tokens && now() - cache.at < GITHUB_TOKEN_CACHE_MS) return cache.tokens;
  cache.at = now();
  cache.tokens = githubTokens(sources);
  return cache.tokens;
}

type Exec = (file: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;

/** The token behind the host's `gh` sign-in for github.com, or null. */
export async function ghAuthToken(exec: Exec = execFileAsync as Exec): Promise<string | null> {
  try {
    const { stdout } = await exec('gh', ['auth', 'token', '--hostname', 'github.com'], {
      env: { ...sanitizeChildEnv(), GH_PROMPT_DISABLED: '1' },
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    const token = stdout.trim();
    return /^\S+$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

interface ConnectorStore {
  list(): { id: string; providerId?: string | null; enabled: boolean; auth: { kind: string } }[];
  openSecret(id: string): Promise<string | null>;
}

/** The personal access tokens of enabled GitHub connectors, in list order. */
export async function connectorGithubTokens(store?: () => Promise<ConnectorStore>): Promise<string[]> {
  try {
    const servers = store ? await store() : (await import('@/lib/integrations/runtime')).getMcpServerStore();
    const tokens: string[] = [];
    for (const entry of servers.list()) {
      if (entry.providerId !== 'github' || entry.auth.kind !== 'bearer' || !entry.enabled) continue;
      const secret = await servers.openSecret(entry.id);
      if (secret) tokens.push(secret);
    }
    return tokens;
  } catch {
    return [];
  }
}
