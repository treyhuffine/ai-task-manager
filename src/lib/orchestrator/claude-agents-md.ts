/**
 * Does the local Claude Code need a CLAUDE.md to see the app root's AGENTS.md?
 *
 * The app root carries only AGENTS.md. Claude Code reads it on its own from
 * 2.1.277, but only where the folder has no CLAUDE.md, and not yet on
 * Bedrock, Vertex or Foundry. Where Claude can't read it, the orchestrator
 * surface opts into a one-line CLAUDE.md that imports AGENTS.md (agentex's
 * `includeNativeFiles`, in harness-surface.ts), which every build honors.
 *
 * Anything the probe can't establish counts as needing the pointer: it is
 * harmless where it isn't needed, and a Claude session without its brief is
 * not.
 */

import { getClaudeAuthStatus } from '@/lib/auth/claude';
import { compareSemver, parseSemver } from '@/lib/utils/semver';

/** First Claude Code release that loads AGENTS.md where a project has no CLAUDE.md. */
export const CLAUDE_READS_AGENTS_MD_SINCE = '2.1.277';

export interface ClaudeInstallProbe {
  /** False when no Claude Code binary is installed. */
  installed: boolean;
  /** Parsed `claude --version`, null when it couldn't be read. */
  version: string | null;
  /** `claude auth status` apiProvider (`firstParty`, `bedrock`, ...), null when unknown. */
  apiProvider: string | null;
}

export function claudeNeedsClaudeMd(probe: ClaudeInstallProbe): boolean {
  if (!probe.installed) return false; // no Claude here to read anything
  if (!probe.version || compareSemver(probe.version, CLAUDE_READS_AGENTS_MD_SINCE) < 0) return true;
  return probe.apiProvider !== 'firstParty';
}

async function probeClaude(): Promise<ClaudeInstallProbe> {
  // Lazy: harness/runtime statically imports agentex, which is ESM-only and
  // would crash the tsx-run CLI's static graph (see harness-surface.ts).
  const { getHarnessRuntime } = await import('@/lib/harness/runtime');
  const runtime = await getHarnessRuntime('claude');
  if (runtime.binary.status === 'missing') return { installed: false, version: null, apiProvider: null };
  const auth = await getClaudeAuthStatus();
  return {
    installed: true,
    version: runtime.binary.version ? parseSemver(runtime.binary.version) : null,
    apiProvider: auth.apiProvider ?? null,
  };
}

const PROBE_TTL_MS = 10 * 60_000;
let cached: { at: number; value: Promise<boolean> } | null = null;

/**
 * `claudeNeedsClaudeMd` for the installed Claude Code. Memoized for ten
 * minutes: it runs on every orchestrator session spawn, and the answer only
 * changes when Claude Code updates or its API provider is switched.
 */
export function shouldWriteClaudeMdPointer(): Promise<boolean> {
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.value;
  const value = probeClaude().then(claudeNeedsClaudeMd, () => true);
  cached = { at: Date.now(), value };
  return value;
}
