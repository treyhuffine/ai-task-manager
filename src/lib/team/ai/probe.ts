/**
 * Whether the team's host can run Team AI as qualified (docs/homes-spec.md
 * §9.9): Claude Code installed, with every flag the launch profile relies on.
 * One without them is unavailable, never launched with a weaker profile.
 */

import { execFile } from 'node:child_process';
import { findBinary } from '@agentex/agent';
import { processState } from '@/lib/process-state';
import { TEAM_AI_LAUNCH_ARGS } from './runtime';
import { teamAiCommand } from './auth';

export interface TeamAiRuntimeProbe {
  ok: boolean;
  version: string | null;
  /** Flags the profile needs that this Claude Code doesn't have. */
  missing: string[];
  error: string | null;
}

const REQUIRED_FLAGS = [...new Set(TEAM_AI_LAUNCH_ARGS.filter((arg) => arg.startsWith('--'))), '--strict-mcp-config', '--mcp-config', '--allowed-tools'];
/** A good answer holds for a while. A failed one is asked again soon: it may have been a slow moment. */
const OK_CACHE_MS = 10 * 60 * 1000;
const FAILED_CACHE_MS = 30 * 1000;

export function probeStillFresh(result: TeamAiRuntimeProbe, at: number, now = Date.now()): boolean {
  return now - at < (result.ok ? OK_CACHE_MS : FAILED_CACHE_MS);
}

const cache = processState('team-ai:probe', () => ({ at: 0, result: null as TeamAiRuntimeProbe | null }));

function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(`${stdout}\n${stderr}`);
    });
  });
}

export async function probeTeamAiRuntime(options: { command?: string; fresh?: boolean } = {}): Promise<TeamAiRuntimeProbe> {
  if (!options.fresh && !options.command && cache.result && probeStillFresh(cache.result, cache.at)) return cache.result;
  let result: TeamAiRuntimeProbe;
  try {
    // The binary the runtime itself would launch, found the same way: on PATH
    // or where Claude Code installs itself, so a service with a short PATH
    // agrees with what a turn would run.
    const resolved = options.command ? { bin: options.command, prefixArgs: [] as string[] } : await findBinary('claude', teamAiCommand());
    const version = (await run(resolved.bin, [...resolved.prefixArgs, '--version'])).trim().split('\n')[0]?.trim() || null;
    const help = await run(resolved.bin, [...resolved.prefixArgs, '--help']);
    const missing = REQUIRED_FLAGS.filter((flag) => !new RegExp(`(^|[\\s,])${flag.replace(/[-]/g, '\\-')}(?=[\\s,<=]|$)`, 'm').test(help));
    result = { ok: missing.length === 0, version, missing, error: null };
  } catch (err) {
    result = { ok: false, version: null, missing: [], error: err instanceof Error ? err.message : String(err) };
  }
  if (!options.command) {
    cache.at = Date.now();
    cache.result = result;
  }
  return result;
}
