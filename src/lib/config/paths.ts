/**
 * Single source of truth for on-disk paths.
 *
 * One home folder, three lifecycle buckets:
 *
 *   <app-root>/               (~/<APP_SHORT_ID>/ by default) — THE home + cwd.
 *   │                          The agent runs here; this is what you sync.
 *   ├── CLAUDE.md AGENTS.md    agent instructions (regenerated from code)
 *   ├── USER.md SOUL.md MEMORY.md   persona + memory
 *   ├── tasks/ notes/ areas/ stream/   markdown mirror (human-readable, git-diffable)
 *   ├── attachments/  .archive/        your files
 *   ├── data.db                canonical DB (binary; tracked for now — see below)
 *   ├── .gitignore             ships excluding .config/ .work/ + db sidecars
 *   ├── .config/               precious-local, NEVER sync: config.json (token), preview.json
 *   └── .work/                 regenerable scratch, NEVER sync, safe to delete:
 *                                clones/ worktrees/ tmp/ backups/ preview/ icons/
 *
 * The split is by two axes — *don't-sync* AND *don't-lose*. `.config` is
 * machine-local but precious (you'd hate to lose the token/settings);
 * `.work` is machine-local and disposable (worktrees rebuild from the git
 * remote, clones re-clone, icons re-fetch). Point your sync (git
 * recommended) at the home; the dotfolders are pre-excluded by the shipped
 * `.gitignore` and are conventionally ignored by sync tools.
 *
 * The DB is canonical now, so it lives in the home and travels via git (a
 * binary, so commit/pull discipline — NOT live cloud-folder sync, which
 * corrupts a hot SQLite file). When two-way mirror↔DB sync lands, the DB
 * demotes to `.work/` (a rebuildable local index) and the home becomes
 * pure text — safe for any sync mechanism. The layout anticipates that
 * without needing a re-layout.
 *
 * Env overrides:
 *   <APP>_ROOT         move the whole home
 *   <APP>_DB_PATH      move just the db (advanced)
 *   <APP>_CONFIG_DIR   move just .config (advanced / sandboxing)
 *   <APP>_WORK_DIR     move just .work (advanced / sandboxing)
 *
 * Never write inside the install directory — it gets wiped on npm update.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_SHORT_ID } from '@/constants/app';
import { renderAppRootClaudeMd } from './claude-md-template';
import { renderBrainMemoryMd } from './memory-template';
import {
  USER_MD_FILENAME,
  SOUL_MD_FILENAME,
  renderUserMdStub,
  renderSoulMdStub,
} from './personalization-templates';

const ENV_PREFIX = APP_SHORT_ID.toUpperCase();

export const APP_ROOT_ENV = `${ENV_PREFIX}_ROOT`;
/** @deprecated The home no longer has a `brain/` subfolder — content lives at
 *  the home root. Kept exported for transitional callers; ignored by path
 *  resolution. Use `<APP>_ROOT` to relocate the home. */
export const BRAIN_PATH_ENV = `${ENV_PREFIX}_BRAIN_PATH`;
export const DB_PATH_ENV = `${ENV_PREFIX}_DB_PATH`;
export const CONFIG_DIR_ENV = `${ENV_PREFIX}_CONFIG_DIR`;
export const WORK_DIR_ENV = `${ENV_PREFIX}_WORK_DIR`;

function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
}

/** The app's home directory — the agent's cwd and the unit you sync. */
export function getAppRoot(): string {
  const override = process.env[APP_ROOT_ENV];
  if (override) return override;
  return path.join(homeDir(), APP_SHORT_ID);
}

/**
 * Dev-mode home. Used by `<cli> start --dev` (and `pnpm dev`) to isolate dev
 * data from production. Opt-in: callers set `process.env[APP_ROOT_ENV]` to
 * this before any path helper runs. Each home carries its own `.config`/
 * `.work`, so dev/prod/test stay fully isolated.
 */
export function getDevAppRoot(): string {
  return path.join(homeDir(), `${APP_SHORT_ID}-dev`);
}

/** Test home. Smoke scripts wipe this; same opt-in contract as dev. */
export function getTestAppRoot(): string {
  return path.join(homeDir(), `${APP_SHORT_ID}-test`);
}

/**
 * @deprecated Content now lives at the home root (no `brain/` subfolder).
 * This is an alias for {@link getAppRoot} so the markdown mirror and other
 * content-root callers keep resolving correctly through the layout change.
 * New code should call `getAppRoot()`.
 */
export function getBrainDir(): string {
  return getAppRoot();
}

export function getDbPath(): string {
  const override = process.env[DB_PATH_ENV];
  if (override) return override;
  return path.join(getAppRoot(), 'data.db');
}

export function getAttachmentsDir(): string {
  return path.join(getAppRoot(), 'attachments');
}

// ─── .config — precious-local (don't sync, don't lose) ────────────

/** Machine-local settings dir: token + preview provider. Never synced. */
export function getConfigDir(): string {
  const override = process.env[CONFIG_DIR_ENV];
  if (override) return override;
  return path.join(getAppRoot(), '.config');
}

export function ensureConfigDir(): string {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

// ─── .work — regenerable scratch (don't sync, safe to delete) ─────

/** Machine-local scratch: worktrees, clones, tmp, backups, pids, icons. */
export function getWorkDir(): string {
  const override = process.env[WORK_DIR_ENV];
  if (override) return override;
  return path.join(getAppRoot(), '.work');
}

export function ensureWorkDir(): string {
  const dir = getWorkDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Where `<cli> takeover` clones workspaces. Per-workspace dir; branches
 * multiplex over one clone. Regenerable runtime state → `.work/clones`.
 */
export function getClonesDir(): string {
  return path.join(getWorkDir(), 'clones');
}

export function ensureClonesDir(): string {
  const dir = getClonesDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function ensureAttachmentsDir(): string {
  const dir = getAttachmentsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Scratch dir for ephemeral files (e.g. the consistent DB dump `backupDb()`
 * stages before upload). Regenerable → `.work/tmp`. Callers clean up after
 * themselves; nothing sweeps it.
 */
export function getTmpDir(): string {
  return path.join(getWorkDir(), 'tmp');
}

export function ensureTmpDir(): string {
  const dir = getTmpDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Recovery/backup staging (the durable backup is the upload target). */
export function getBackupsDir(): string {
  return path.join(getWorkDir(), 'backups');
}

export function ensureBackupsDir(): string {
  const dir = getBackupsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// ─── Home bootstrap ───────────────────────────────────────────────

const GITIGNORE_BODY = `# ${APP_SHORT_ID} — machine-local plumbing, never sync
.config/
.work/
# Legacy worktree/clone locations (pre-2026-06-16 installs put these at the
# home root; new ones live in .work/). They're DB-referenced by absolute
# path + may hold uncommitted work, so the migration leaves them in place —
# just keep them out of sync here.
worktrees/
clones/
# SQLite runtime sidecars (data.db itself is tracked while it's canonical)
*.db-wal
*.db-shm
# Local dated snapshots (each bundles a full binary data.db dump → would
# bloat history). The remote backup is the durable copy; these are local.
snapshots/
`;

export function ensureAppRoot(): string {
  const dir = getAppRoot();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Best-effort on platforms without POSIX permissions.
    }
  }

  // Orient any agent that opens a session in the home. Written once — never
  // overwritten — so users can edit freely. The orchestrator brief's managed
  // block is regenerated separately (installInstructions).
  const claudeMdPath = path.join(dir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, renderAppRootClaudeMd(), { mode: 0o600 });
  }

  // Ship a .gitignore so `git init && commit` syncs the home correctly with
  // zero thought — the machine-local dotfolders + DB sidecars are excluded.
  // Write-once; users own it after.
  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, GITIGNORE_BODY, { mode: 0o644 });
  }

  return dir;
}

/**
 * Ensure the home exists and seed the content files that live at its root:
 * MEMORY.md (agent memory) + USER.md / SOUL.md (user-owned personalization
 * the orchestrator brief references). All write-once — never overwritten, so
 * user edits survive while the app regenerates the brief around them.
 *
 * Named `ensureBrainDir` for transitional compatibility; there's no `brain/`
 * subfolder anymore — these seed at the home root.
 */
export function ensureBrainDir(): string {
  const dir = ensureAppRoot();

  const seed = (filename: string, render: () => string) => {
    const p = path.join(dir, filename);
    if (!fs.existsSync(p)) fs.writeFileSync(p, render(), { mode: 0o600 });
  };
  seed('MEMORY.md', renderBrainMemoryMd);
  seed(USER_MD_FILENAME, renderUserMdStub);
  seed(SOUL_MD_FILENAME, renderSoulMdStub);

  return dir;
}

// ─── Layout migration ─────────────────────────────────────────────

/** Portable content that belongs at the home root. */
const CONTENT_ENTRIES = [
  'data.db', 'data.db-wal', 'data.db-shm',
  'tasks', 'notes', 'areas', 'stream', 'streams',
  'attachments', '.archive', 'skills',
  'MEMORY.md', 'USER.md', 'SOUL.md', 'README.md',
];
/**
 * Machine-local scratch that belongs in `.work`. Deliberately EXCLUDES
 * `worktrees` and `clones`: those are referenced by absolute path in the DB
 * (`executions.worktreePath`, `workspaces.worktreeRoot`) and may hold
 * uncommitted work or be open in an editor — moving them would break the
 * references and disrupt live sessions. They're regenerable, so existing
 * ones stay put (DB stays valid) and only NEW ones are created under
 * `.work/` (see `getClonesDir` / `defaultWorktreeRoot`); both legacy root
 * locations are gitignored so they still don't sync.
 */
const WORK_ENTRIES = ['tmp', 'backups', 'preview', 'icons'];
/** Precious-local settings that belong in `.config`. */
const CONFIG_ENTRIES = ['config.json', 'preview.json', 'cli-config.json'];

/** Move `src`→`dest` if `src` exists and `dest` doesn't. Idempotent. In
 *  dryRun, records the planned move without touching disk. */
function migrateMove(src: string, dest: string, moved: string[], dryRun: boolean): void {
  try {
    if (!fs.existsSync(src)) return;
    if (fs.existsSync(dest)) return; // already migrated / would clobber
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      fs.renameSync(src, dest);
    }
    moved.push(`${src} → ${dest}`);
  } catch (err) {
    console.warn(`[paths] migrateLayout: failed to move ${src} → ${dest}:`, err);
  }
}

/**
 * Migrate any prior on-disk layout to the current one (home root + `.config`
 * + `.work`). Handles installs whose content is still under `brain/` (pull up
 * to root, splitting machine-local `icons`/`preview` into `.work`) AND flat
 * installs (content already at root, just relocate config/scratch). Idempotent
 * — every move is skip-if-done.
 *
 * NOT run automatically — existing installs invoke it once via
 * `pnpm migrate:layout` (scripts/migrate-layout.ts). Fresh installs need
 * nothing. Skipped when `<APP>_DB_PATH` is set (advanced users managing their
 * own DB location shouldn't have their tree reshuffled). Pass `{ dryRun: true }`
 * to preview the moves without touching disk.
 *
 * Worktrees/clones are deliberately NOT moved — see `WORK_ENTRIES`.
 */
export function migrateLayout(
  opts: { dryRun?: boolean } = {},
): { migrated: boolean; moved: string[] } {
  const dryRun = opts.dryRun ?? false;
  if (process.env[DB_PATH_ENV]) return { migrated: false, moved: [] };

  const root = getAppRoot();
  if (!fs.existsSync(root)) return { migrated: false, moved: [] };

  const moved: string[] = [];
  const brain = path.join(root, 'brain');

  // 1. brain/ → root (content) and brain/{icons,preview} → .work.
  if (fs.existsSync(brain)) {
    for (const name of CONTENT_ENTRIES) {
      migrateMove(path.join(brain, name), path.join(root, name), moved, dryRun);
    }
    for (const name of WORK_ENTRIES) {
      migrateMove(path.join(brain, name), path.join(getWorkDir(), name), moved, dryRun);
    }
    // Drop brain/ if we emptied it (best-effort; leaves it if user has extras).
    if (!dryRun) {
      try {
        if (fs.readdirSync(brain).length === 0) fs.rmdirSync(brain);
      } catch { /* leave non-empty brain in place */ }
    }
  }

  // 2. root → .config (settings) and root → .work (scratch).
  for (const name of CONFIG_ENTRIES) {
    migrateMove(path.join(root, name), path.join(getConfigDir(), name), moved, dryRun);
  }
  for (const name of WORK_ENTRIES) {
    migrateMove(path.join(root, name), path.join(getWorkDir(), name), moved, dryRun);
  }

  return { migrated: moved.length > 0, moved };
}
