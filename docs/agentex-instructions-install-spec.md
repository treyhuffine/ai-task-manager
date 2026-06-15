# Spec: agentex `installInstructions` — cross-runtime instruction files

**Status:** proposed. Written against `@agentex/agent@0.0.20`.
**Audience:** the agentex repo's coding agent. (Flow = host app embedding agentex sessions; see `docs/orchestrator-harness.md`.)
**One-liner:** the instruction-file twin of `installSkills` — drop a brief into the right per-runtime filename(s), with a **managed-region merge** that preserves user edits.

---

## Motivation

agentex already centralizes "where does each runtime discover skills" (`installSkills` → `.claude/skills/` + `.agents/skills/`). The parallel knowledge for **instruction files** is not exposed:

| Runtime | Instruction file it reads |
|---|---|
| Claude Code | `CLAUDE.md` |
| Codex / Gemini / Cursor / OpenCode / Pi | `AGENTS.md` |

Today `resolveInstructions(path)` only **reads** a file. Every host that wants to *install* an orientation brief hand-rolls: the per-runtime filename mapping, the global-vs-workspace location logic, and — the actually-hard part — merging into an existing file without clobbering the user's own edits. Flow re-implements all three in `src/lib/config/claude-md-template.ts` + `src/lib/orchestrator/harness-surface.ts`.

## Priority order (this determines host adoption)

1. **P0 — managed-region merge.** Without it the installer just overwrites, and any host with user-editable instruction files (Flow included) can't use it. This is the reuse that justifies the feature.
2. **P1 — per-runtime filename mapping + location logic.** The `installSkills`-shaped ergonomics.
3. **P2 — symlink mode.** A convenience for one-source-of-truth hosts. Opt-in, default off. **Flow will not use it** (see Non-goals) but it's harmless to offer.

## Proposed API

Mirror `installSkills` for consistency (same `location`/`cwd`, same result-envelope shape).

```ts
export interface InstallInstructionsOptions {
  /**
   * Which runtimes' instruction files to write. Defaults to all known
   * runtimes, deduped by filename — so the default writes CLAUDE.md +
   * AGENTS.md exactly once each (not AGENTS.md five times).
   */
  runtimes?: SkillRuntime[];               // reuse the existing SkillRuntime union
  /** "global" (~/) or "workspace" ({cwd}/). Same semantics as installSkills. */
  location?: 'global' | 'workspace';
  cwd?: string;                            // required for "workspace"

  /**
   * RECOMMENDED. Wrap `content` in managed markers and merge into any
   * existing file, replacing only the previously-managed region and
   * preserving everything the user wrote outside it. Without this the
   * file is overwritten wholesale (and a prior managed block, if any, is
   * lost). Default: true.
   */
  managed?: boolean;
  /**
   * Marker tag, so the comment reads `<!-- <tag>:managed:start -->`.
   * Lets a host brand its block + run multiple independent installers
   * without fighting over one region. Default: "agentex".
   */
  managedTag?: string;

  /**
   * Write one canonical file and make the others symlinks to it instead
   * of duplicating content. One source of truth, BUT: sync tools
   * (iCloud/Dropbox) often deref or drop symlinks, and git symlink
   * checkout isn't honored on Windows. Unsafe in synced/tracked dirs.
   * Mutually exclusive with per-file user content (a symlink can't carry
   * different out-of-band edits per runtime). Default: false.
   */
  symlink?: boolean;
}

export interface InstructionInstallResult {
  installed: number;
  skipped: number;       // content already current → no write
  conflicts: number;     // symlink mode: a real file already sat at the target
  errors: number;
  entries: Array<{
    runtime: SkillRuntime;
    path: string;        // absolute path written/symlinked
    status: 'created' | 'updated' | 'skipped' | 'symlinked' | 'conflict' | 'error';
    error?: string;
  }>;
}

export function installInstructions(
  content: string,
  options?: InstallInstructionsOptions,
): Promise<InstructionInstallResult>;
```

### Managed-merge semantics (the P0 detail)

This is the load-bearing behavior — spec it precisely, because it's the part hosts get wrong:

- Managed block delimited by `<!-- <tag>:managed:start … -->` / `<!-- <tag>:managed:end -->`.
- **Existing file with markers:** replace only the bytes between them; leave everything before/after byte-identical.
- **Existing file without markers:** prepend the managed block, keep the prior content below it (treat it as user-authored — never discard).
- **No file:** create with just the managed block.
- **`managed: false`:** overwrite the whole file with raw `content` (escape hatch for static, fully-owned files).
- **`skipped`:** if the merged result equals current file bytes, don't write (keeps mtimes stable; avoids sync churn).
- File mode `0600` on create (these can carry tokens/PII in some hosts).

Reference implementation to match: Flow's `upsertManagedBlock` in `src/lib/config/claude-md-template.ts` already does exactly this (markers, replace-inside, preserve-outside, prepend-if-absent). It's ~30 lines — happy to hand it over verbatim as the starting point.

### Symlink semantics (P2)

- Pick a canonical filename (e.g. the first requested runtime's, or always `AGENTS.md` since it's the broad one) — write content there, `symlink` the rest at it.
- If a non-symlink file already exists at a target, **don't overwrite** — return `status: 'conflict'` and leave it. (A host that wants to convert must remove it first; silent clobber of a real file is the worst outcome.)
- Document the sync/Windows caveat on the option, not just here.
- `managed` + `symlink` together: apply the managed merge to the canonical file; symlinks inherit it. Fine, but the per-file user-content benefit of `managed` is lost — note that.

## Acceptance

- `installInstructions(text)` with defaults → `CLAUDE.md` + `AGENTS.md` both contain the managed block; idempotent re-run reports all `skipped`.
- User content appended outside the markers survives a re-install with changed `content`.
- A pre-existing marker-less file is preserved below a freshly-prepended block.
- `symlink: true` → one real file + N symlinks; a pre-existing real file at a target yields `conflict`, not overwrite.
- `location: 'workspace'` writes under `{cwd}/`; `'global'` under `~/`.

## Non-goals / Flow's intended use

- **Flow will call this with `managed: true, symlink: false`** and then delete its own `upsertManagedBlock` + the dual-write in `harness-surface.ts`. We keep two real files (per-runtime user edits + `brain/` is git-tracked/synced, where symlinks break).
- Not a templating engine — `content` is rendered by the host. (agentex's `renderTemplate` stays separate.)
- Not coupled to `ProviderConfig.instructionsFile` — that's the per-spawn `--append-system-prompt-file` path (system-prompt injection). This is the on-disk, walk-up-discoverable, user-editable brief. Different layer; both should exist.
