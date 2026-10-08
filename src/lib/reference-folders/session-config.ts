/**
 * Turns a workspace's linked (reference) folders into the bits an agent
 * session needs (docs/reference-folders-spec.md §7).
 *
 * A folder is editable unless the person marked it read only (`isReadOnly`).
 * Four separate concerns, and it's worth being precise about how far each one
 * reaches, because "read only" is doing a lot of work in the UI copy:
 *
 *   1. `instructions` — the prompt block. Delivered through agentex's
 *      `instructionsFile`, which every provider resolves (claude maps it to
 *      `--append-system-prompt-file`, codex folds it into base instructions).
 *      This is the portable part and the actual feature. It says which folders
 *      may be changed and which may not.
 *   2. `addDirs` — `--add-dir` per folder, claude only. Without it claude's
 *      Read tool is confined to the working directory. It grants read and
 *      write. Verified against Claude Code 2.1.220: repeated `--add-dir` flags
 *      accumulate rather than overwrite, so these coexist with the one agentex
 *      pushes for skills.
 *   3. `disallowedTools` — the write guard on read-only folders, claude only.
 *   4. `writableDirs` — the editable folders, which codex's `workspace-write`
 *      sandbox (its default in Ask and Auto-edit) would otherwise refuse to
 *      write outside the working folder without asking.
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
import { isReadOnly } from './read-only';

export interface ReferenceFolderSessionConfig {
  /** The prompt block. Empty string when there is nothing to say. */
  instructions: string;
  /** Absolute paths to expose to the agent's file tools. */
  addDirs: string[];
  /** The read-only folders' paths, where the write guard applies. */
  readOnlyDirs: string[];
  /** The editable folders' paths. A path also linked read only isn't one. */
  writableDirs: string[];
  /** Deny rules keeping the edit-family tools out of the read-only folders. */
  disallowedTools: string[];
}

/**
 * Claude Code's file-permission specifier for an absolute path is the path
 * with an extra leading slash: `/Users/x/api` becomes `//Users/x/api`.
 */
export function editDenyRule(absolutePath: string): string {
  return `Edit(/${absolutePath}/**)`;
}

/**
 * Codex's extra writable folders for its `workspace-write` sandbox, as a root
 * `-c` override, which `codex app-server` reads (verified on codex-cli 0.160:
 * `--strict-config` accepts the key and type-checks the list). The value is a
 * TOML array, and a JSON array of strings is valid TOML. It replaces any
 * `writable_roots` set in the person's `~/.codex/config.toml` for this
 * session. Under `danger-full-access` (Auto) and `read-only` (Plan) Codex
 * ignores it.
 */
export function codexWritableRootsArgs(paths: string[]): string[] {
  if (paths.length === 0) return [];
  return ['-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(paths)}`];
}

const EMPTY: ReferenceFolderSessionConfig = { instructions: '', addDirs: [], readOnlyDirs: [], writableDirs: [], disallowedTools: [] };

export function buildReferenceFolderSessionConfig(
  refs: PromptReferenceFolder[],
): ReferenceFolderSessionConfig {
  if (refs.length === 0) return { ...EMPTY };

  // Two references may legitimately resolve to the same folder under different
  // aliases. Dedupe the argv side so the CLI doesn't get the same path twice.
  // If either alias is read only, the folder is: the guard wins over the
  // looser link.
  const paths = [...new Set(refs.map((r) => r.absolutePath))];
  const readOnly = new Set(refs.filter(isReadOnly).map((r) => r.absolutePath));
  const readOnlyDirs = paths.filter((p) => readOnly.has(p));
  return {
    instructions: renderReferenceFoldersPrompt(refs),
    addDirs: paths,
    readOnlyDirs,
    writableDirs: paths.filter((p) => !readOnly.has(p)),
    disallowedTools: readOnlyDirs.map(editDenyRule),
  };
}

/** Providers that enforce argv tool filtering (`--add-dir`, `--disallowed-tools`). */
const ARGV_TOOL_FILTER_PROVIDERS = new Set(['claude']);

/**
 * How much of the feature a given provider actually gets.
 *
 *   full        — the prompt block, read scope, and the read-only folders
 *                 fenced off (or none to fence).
 *   prompt-only — the agent is told, but the read-only folders aren't fenced
 *                 off. Only ever reported when there is a read-only folder.
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
  // agent never learns the folders exist (see session-instructions.ts). Every
  // harness that reads it but isn't Claude (codex, antigravity) is told about
  // the folders without the read-only ones being fenced off.
  if (!providerDeliversSessionInstructions(providerType)) return inert;
  if (!ARGV_TOOL_FILTER_PROVIDERS.has(providerType)) {
    return {
      ...inert,
      delivery: config.readOnlyDirs.length > 0 ? 'prompt-only' : 'full',
      deliversInstructions: true,
      extraArgs: providerType === 'codex' ? codexWritableRootsArgs(config.writableDirs) : [],
    };
  }
  return {
    delivery: 'full',
    deliversInstructions: true,
    extraArgs: config.addDirs.flatMap((dir) => ['--add-dir', dir]),
    disallowedTools: config.disallowedTools,
  };
}
