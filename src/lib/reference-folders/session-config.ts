/**
 * Turns a workspace's reference folders into the bits an agent session needs
 * (docs/reference-folders-spec.md §7).
 *
 * Three separate concerns, and it's worth being precise about how far each one
 * reaches, because "read-only" is doing a lot of work in the UI copy:
 *
 *   1. `instructions` — the prompt block. Delivered through agentex's
 *      `instructionsFile`, which every provider resolves (claude maps it to
 *      `--append-system-prompt-file`, codex folds it into base instructions).
 *      This is the portable part and the actual feature.
 *   2. `addDirs` — `--add-dir` per folder, claude only. Without it claude's
 *      Read tool is confined to the working directory. Verified against
 *      Claude Code 2.1.220: repeated `--add-dir` flags accumulate rather than
 *      overwrite, so these coexist with the one agentex pushes for skills.
 *   3. `disallowedTools` — the write guard, claude only.
 *
 * On the guard, verified empirically against Claude Code 2.1.220 rather than
 * assumed:
 *
 *   - `Edit(//<abs>/**)` binds. A Write attempt into a denied reference folder
 *     is refused and the file is left untouched, even under
 *     `--dangerously-skip-permissions`. Deny wins.
 *   - `Write(//<abs>/**)` is NOT a valid rule. The CLI says so out loud:
 *     "only Edit(path) rules are [matched by file permission checks] ...
 *     Edit rules cover all file-editing tools." So we emit Edit rules only.
 *   - Bash is not covered by Edit rules. A shell redirect could still write
 *     into a reference folder. This is a guard, not a sandbox, which is why
 *     the prompt block says not to modify these folders and why the UI copy
 *     must not promise more.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getWorkDir } from '@/lib/config/paths';
import { renderReferenceFoldersPrompt } from '@/lib/executor/prompts/reference-folders';
import type { ResolvedReferenceFolder } from '@/db/types';

export interface ReferenceFolderSessionConfig {
  /** The prompt block. Empty string when there is nothing to say. */
  instructions: string;
  /** Absolute paths to expose to the agent's file tools. */
  addDirs: string[];
  /** Deny rules keeping the edit-family tools out of those paths. */
  disallowedTools: string[];
}

/**
 * Claude Code's file-permission specifier for an absolute path is the path
 * with an extra leading slash: `/Users/x/api` becomes `//Users/x/api`.
 */
export function editDenyRule(absolutePath: string): string {
  return `Edit(/${absolutePath}/**)`;
}

export function buildReferenceFolderSessionConfig(
  refs: ResolvedReferenceFolder[],
): ReferenceFolderSessionConfig {
  if (refs.length === 0) return { instructions: '', addDirs: [], disallowedTools: [] };

  // Two references may legitimately resolve to the same folder under different
  // aliases. Dedupe the argv side so the CLI doesn't get the same path twice.
  const paths = [...new Set(refs.map((r) => r.absolutePath))];
  return {
    instructions: renderReferenceFoldersPrompt(refs),
    addDirs: paths,
    disallowedTools: paths.map(editDenyRule),
  };
}

/**
 * Providers whose *session* path honours agentex's `instructionsFile`.
 *
 * Checked against agentex 0.0.34 source, not assumed: `instructionsFile` is
 * read in `providers/<p>/session.ts` for claude, codex and pi, but only in
 * `execute.ts` (the one-shot path) for cursor and opencode. Flow always goes
 * through `createSession`, so on cursor and opencode the field is silently
 * dropped and the agent never learns the folders exist.
 *
 * That has to be reported honestly rather than warned about as a partial
 * degradation, because it is a total one. Revisit whenever agentex grows
 * session-scoped instructions for the remaining providers.
 */
const SESSION_INSTRUCTIONS_PROVIDERS = new Set(['claude', 'codex', 'pi']);

/** Providers that enforce argv tool filtering (`--add-dir`, `--disallowed-tools`). */
const ARGV_TOOL_FILTER_PROVIDERS = new Set(['claude']);

/**
 * How much of the feature a given provider actually gets.
 *
 *   full        — prompt block, read scope, and the edit deny rules.
 *   prompt-only — the agent is told, but nothing fences it off.
 *   unsupported — the provider cannot be told at all through the session API.
 */
export type ReferenceFolderDelivery = 'full' | 'prompt-only' | 'unsupported';

export interface ReferenceFolderProviderWiring {
  delivery: ReferenceFolderDelivery;
  /** Whether the caller should set `config.instructionsFile`. */
  deliversInstructions: boolean;
  /** Argv to append. Empty for providers that don't understand these flags. */
  extraArgs: string[];
  /** Deny rules to merge into the session config. */
  disallowedTools: string[];
}

export function referenceFolderProviderWiring(
  config: ReferenceFolderSessionConfig,
  providerType: string,
): ReferenceFolderProviderWiring {
  const inert: ReferenceFolderProviderWiring = {
    delivery: 'unsupported',
    deliversInstructions: false,
    extraArgs: [],
    disallowedTools: [],
  };
  if (!config.instructions) return { ...inert, delivery: 'full' };
  if (!SESSION_INSTRUCTIONS_PROVIDERS.has(providerType)) return inert;
  if (!ARGV_TOOL_FILTER_PROVIDERS.has(providerType)) {
    return { ...inert, delivery: 'prompt-only', deliversInstructions: true };
  }
  return {
    delivery: 'full',
    deliversInstructions: true,
    extraArgs: config.addDirs.flatMap((dir) => ['--add-dir', dir]),
    disallowedTools: config.disallowedTools,
  };
}

/**
 * Persist the prompt block so it can be handed over as `instructionsFile`.
 * Lives in the scratch work dir keyed by chat session, rewritten on every
 * session build, so it always matches the current reference list.
 */
export function writeReferenceFolderInstructions(
  chatSessionId: string,
  instructions: string,
): string {
  mkdirSync(referenceInstructionsDir(), { recursive: true, mode: 0o700 });
  const file = referenceInstructionsPath(chatSessionId);
  writeFileSync(file, `${instructions}\n`, { mode: 0o600 });
  return file;
}

function referenceInstructionsDir(): string {
  return path.join(getWorkDir(), 'reference-folders');
}

export function referenceInstructionsPath(chatSessionId: string): string {
  return path.join(referenceInstructionsDir(), `${chatSessionId}.md`);
}

/**
 * Drop a session's instruction file when its agent session closes. Without
 * this every chat session ever opened leaves a file behind in the scratch dir.
 * Best-effort: the file is regenerated on the next spawn, so a failure here is
 * never worth surfacing.
 */
export function clearReferenceFolderInstructions(chatSessionId: string): void {
  try {
    rmSync(referenceInstructionsPath(chatSessionId), { force: true });
  } catch {
    /* scratch cleanup, never load-bearing */
  }
}
