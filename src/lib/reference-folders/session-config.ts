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

import { renderReferenceFoldersPrompt, type PromptReferenceFolder } from '@/lib/executor/prompts/reference-folders';
import { providerDeliversSessionInstructions } from '@/lib/executor/session-instructions';

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
  refs: PromptReferenceFolder[],
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
  // On cursor and opencode the session path drops `instructionsFile`, so the
  // agent never learns the folders exist (see session-instructions.ts).
  if (!providerDeliversSessionInstructions(providerType)) return inert;
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
