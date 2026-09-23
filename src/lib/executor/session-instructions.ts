/**
 * One instructions file per chat session, handed to agentex as
 * `instructionsFile` when the harness process spawns.
 *
 * Several features want to tell a session something at spawn time without it
 * showing up in the visible transcript: an agent's standing instructions
 * (docs/agents-view-spec.md Phase 3), the reference-folder block
 * (docs/reference-folders-spec.md §7), and an agent main chat's brief. agentex
 * takes a single file, so the blocks are composed here into one. The file is
 * rewritten on every session build, so it always matches current settings, and
 * removed when the session closes.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getWorkDir } from '@/lib/config/paths';

/**
 * Providers whose *session* path honours agentex's `instructionsFile`.
 *
 * Checked against agentex 0.0.34 source, not assumed: `instructionsFile` is
 * read in `providers/<p>/session.ts` for claude, codex and pi, but only in
 * `execute.ts` (the one-shot path) for cursor and opencode. Ri always goes
 * through `createSession`, so on cursor and opencode the field is silently
 * dropped and the session never sees the text. Callers report that honestly
 * rather than as a partial degradation, because it is a total one. Revisit
 * whenever agentex grows session-scoped instructions for the rest.
 */
const SESSION_INSTRUCTIONS_PROVIDERS = new Set(['claude', 'codex', 'pi']);

export function providerDeliversSessionInstructions(providerType: string): boolean {
  return SESSION_INSTRUCTIONS_PROVIDERS.has(providerType);
}

export interface SessionInstructionBlock {
  /** Human name for logs ("agent instructions", "reference folders"). */
  name: string;
  /** The block's text. Blank or missing means the block has nothing to say. */
  text: string | null | undefined;
}

export interface SessionInstructionsPlan {
  /** Text for `instructionsFile`, or '' when there is nothing to deliver. */
  text: string;
  /** Names of blocks that had something to say but this provider can't receive. */
  undelivered: string[];
}

/**
 * Decide what a session is told at spawn: the non-empty blocks in order,
 * joined, or nothing plus the list of what was lost when the provider drops
 * session instructions.
 */
export function planSessionInstructions(
  providerType: string,
  blocks: SessionInstructionBlock[],
): SessionInstructionsPlan {
  const present = blocks
    .map((block) => ({ name: block.name, text: block.text?.trim() ?? '' }))
    .filter((block) => block.text.length > 0);
  if (present.length === 0) return { text: '', undelivered: [] };
  if (!providerDeliversSessionInstructions(providerType)) {
    return { text: '', undelivered: present.map((block) => block.name) };
  }
  return { text: present.map((block) => block.text).join('\n\n'), undelivered: [] };
}

/** Persist the composed text and return the path to hand over as `instructionsFile`. */
export function writeSessionInstructions(chatSessionId: string, text: string): string {
  mkdirSync(sessionInstructionsDir(), { recursive: true, mode: 0o700 });
  const file = sessionInstructionsPath(chatSessionId);
  writeFileSync(file, `${text}\n`, { mode: 0o600 });
  return file;
}

function sessionInstructionsDir(): string {
  return path.join(getWorkDir(), 'session-instructions');
}

export function sessionInstructionsPath(chatSessionId: string): string {
  return path.join(sessionInstructionsDir(), `${chatSessionId}.md`);
}

/**
 * Drop a session's instruction file when its harness session closes. Without
 * this every chat ever opened leaves a file behind in the scratch dir.
 * Best-effort: the file is regenerated on the next spawn, so a failure here is
 * never worth surfacing.
 */
export function clearSessionInstructions(chatSessionId: string): void {
  try {
    rmSync(sessionInstructionsPath(chatSessionId), { force: true });
  } catch {
    /* scratch cleanup, never load-bearing */
  }
}
