/**
 * Read-only inventory of a Ri data root.
 *
 *   pnpm tsx scripts/inventory-root.ts <root> [--json <out-file>] [--no-git]
 *
 * Answers "what lives here, and what would be lost if this root went away"
 * before any consolidation, move, or retirement (docs/homes-spec.md §10.2):
 * personal records, attachments, agent identities and their folders,
 * executions and their unpublished code, native transcripts, schedules,
 * paired devices, and machine config (secret values are never printed).
 *
 * It never writes to the root. The database is read without creating sidecar
 * files (`src/lib/home/source-db.ts`), git runs with --no-optional-locks so
 * status does not refresh an index, and the report goes to stdout or to a
 * file you name outside the root.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { withSourceDatabase } from '../src/lib/home/source-db';

interface Args {
  root: string;
  jsonOut?: string;
  git: boolean;
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function parseArgs(argv: string[]): Args {
  let root: string | undefined;
  let jsonOut: string | undefined;
  let git = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') jsonOut = argv[++i];
    else if (a === '--no-git') git = false;
    else if (!root) root = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!root) {
    console.error('usage: pnpm tsx scripts/inventory-root.ts <root> [--json <out-file>] [--no-git]');
    process.exit(2);
  }
  return { root: path.resolve(expandHome(root)), jsonOut: jsonOut && path.resolve(expandHome(jsonOut)), git };
}

function duKb(p: string): number | null {
  if (!fs.existsSync(p)) return null;
  try {
    return Number(execFileSync('du', ['-sk', p], { encoding: 'utf8' }).split(/\s+/)[0]);
  } catch {
    return null;
  }
}

function countFiles(dir: string): number | null {
  if (!fs.existsSync(dir)) return null;
  let n = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  walk(dir);
  return n;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['--no-optional-locks', '-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    }).trim();
  } catch {
    return null;
  }
}

/** Code in a checkout that no remote has: dirty files and unpushed commits. */
function unpublished(cwd: string) {
  if (!fs.existsSync(cwd)) return { exists: false as const };
  const status = git(cwd, ['status', '--porcelain']);
  if (status === null) return { exists: true as const, git: false as const };
  const ahead = git(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes']);
  return {
    exists: true as const,
    git: true as const,
    branch: git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    dirtyFiles: status ? status.split('\n').length : 0,
    commitsOnNoRemote: ahead === null ? null : Number(ahead),
  };
}

/** Config keys whose values are credentials. Presence is reported, never the value. */
const SECRET_CONFIG_KEYS = new Set(['localToken']);

function readConfig(configDir: string) {
  const file = path.join(configDir, 'config.json');
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = SECRET_CONFIG_KEYS.has(k) ? (v ? '<set>' : null) : v;
  }
  return out;
}

function listDir(dir: string): string[] | null {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).sort();
}

type Row = Record<string, unknown>;

function inventoryDb(dbPath: string, gitChecks: boolean) {
  return withSourceDatabase(dbPath, (db) => inventoryOpenDb(db, gitChecks));
}

function inventoryOpenDb(db: Database.Database, gitChecks: boolean) {
  const all = (sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as Row[];
  const get = (sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as Row | undefined;
  const tableNames = all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).map((r) => String(r.name));
  const has = (t: string) => tableNames.includes(t);
  const columns = (t: string) =>
    has(t) ? all(`PRAGMA table_info("${t}")`).map((c) => String(c.name)) : [];
  // Older roots predate columns this report reads. A section whose columns
  // are missing reports null rather than failing the whole inventory.
  const hasCols = (t: string, ...cols: string[]) => {
    const present = columns(t);
    return has(t) && cols.every((c) => present.includes(c));
  };
  const safe = <T,>(fn: () => T): T | { error: string } => {
    try {
      return fn();
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };

  const rowCounts: Record<string, number> = {};
  for (const t of tableNames) {
    // Virtual table shadows (FTS, vec) are counted too. They are cheap and
    // show whether the search indexes match their sources.
    try {
      rowCounts[t] = Number(get(`SELECT count(*) AS n FROM "${t}"`)?.n ?? 0);
    } catch {
      rowCounts[t] = -1;
    }
  }

  const groupBy = (table: string, col: string) =>
    hasCols(table, col)
      ? Object.fromEntries(
          all(`SELECT ${col} AS k, count(*) AS n FROM "${table}" GROUP BY ${col} ORDER BY n DESC`).map(
            (r) => [String(r.k), Number(r.n)],
          ),
        )
      : null;

  const migrations = has('__drizzle_migrations')
    ? all('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').map((r) => ({
        hash: String(r.hash).slice(0, 12),
        createdAt: r.created_at,
      }))
    : null;

  const workspaces = hasCols('workspaces', 'cwd', 'is_git', 'worktree_root', 'remote_name')
    ? safe(() => all(
        'SELECT id, name, slug, cwd, is_git, worktree_root, status, base_branch, remote_name FROM workspaces ORDER BY position',
      ).map((w) => {
        const cwd = String(w.cwd);
        const exists = fs.existsSync(cwd);
        return {
          id: w.id,
          name: w.name,
          status: w.status,
          isGit: Boolean(w.is_git),
          cwd,
          cwdExists: exists,
          worktreeRoot: w.worktree_root,
          remoteUrl:
            gitChecks && exists && w.is_git
              ? git(cwd, ['remote', 'get-url', String(w.remote_name ?? 'origin')])
              : undefined,
          sourceCheckout: gitChecks && exists && w.is_git ? unpublished(cwd) : undefined,
          riLocalJson: exists ? fs.existsSync(path.join(cwd, '.ri.local.json')) : false,
        };
      }))
    : null;

  const references = has('reference_folders')
    ? safe(() => all(
        "SELECT id, workspace_id, alias, path, target_workspace_id, status FROM reference_folders WHERE status = 'active'",
      ).map((r) => ({
        alias: r.alias,
        scope: r.workspace_id ? 'agent' : 'global',
        workspaceId: r.workspace_id,
        path: r.path,
        pathExists: r.path ? fs.existsSync(String(r.path)) : undefined,
        targetWorkspaceId: r.target_workspace_id,
      })))
    : null;

  const activeExecutions = hasCols('executions', 'worktree_path', 'takeover_started_at')
    ? safe(() => all(
        `SELECT e.id, e.workspace_id, e.label, e.worktree_path, e.branch_name, e.base_sha,
                e.takeover_started_at, e.created_at
           FROM executions e WHERE e.status = 'active' ORDER BY e.created_at`,
      ).map((e) => ({
        id: e.id,
        workspaceId: e.workspace_id,
        label: e.label,
        branch: e.branch_name,
        worktreePath: e.worktree_path,
        inTakeover: Boolean(e.takeover_started_at),
        worktree: gitChecks && e.worktree_path ? unpublished(String(e.worktree_path)) : undefined,
      })))
    : null;

  const transcripts = hasCols('chat_sessions', 'external_transcript_path', 'external_session_id')
    ? safe(() => {
        const rows = all(
          'SELECT external_transcript_path AS p FROM chat_sessions WHERE external_transcript_path IS NOT NULL',
        );
        const onDisk = rows.filter((r) => fs.existsSync(String(r.p))).length;
        return {
          chatsWithNativeSession: Number(
            get('SELECT count(*) AS n FROM chat_sessions WHERE external_session_id IS NOT NULL')?.n ?? 0,
          ),
          chatsWithTranscriptPath: rows.length,
          transcriptPathsOnDisk: onDisk,
          byHarness: groupBy('chat_sessions', 'harness'),
          byType: groupBy('chat_sessions', 'type'),
        };
      })
    : null;

  const schedules = hasCols('triggers', 'kind', 'target_kind', 'enabled')
    ? all(
        `SELECT kind, target_kind, enabled, count(*) AS n FROM triggers
          GROUP BY kind, target_kind, enabled ORDER BY n DESC`,
      )
    : null;

  const devices = hasCols('api_keys', 'device_type', 'revoked_at')
    ? all(
        `SELECT device_type, count(*) AS n,
                sum(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active
           FROM api_keys GROUP BY device_type`,
      )
    : null;

  const referencedAttachments = (() => {
    const names = new Set<string>();
    for (const t of ['tasks', 'notes', 'areas', 'stream', 'chat_events', 'workspaces']) {
      if (!has(t)) continue;
      if (!hasCols(t, 'attachments')) continue;
      for (const r of all(`SELECT attachments FROM "${t}" WHERE attachments IS NOT NULL AND attachments != '[]'`)) {
        try {
          for (const a of JSON.parse(String(r.attachments)) as { file_name?: string }[]) {
            if (a?.file_name) names.add(a.file_name);
          }
        } catch {
          /* malformed JSON is reported by the count mismatch */
        }
      }
    }
    return names;
  })();

  return {
    integrity: String(get('PRAGMA quick_check')?.quick_check ?? 'unknown'),
    migrations,
    rowCounts,
    records: {
      tasksByStatus: groupBy('tasks', 'status'),
      notesByStatus: has('notes') ? groupBy('notes', 'status') : null,
      streamByStatus: groupBy('stream', 'status'),
      areas: rowCounts.areas ?? null,
    },
    workspaces,
    references,
    executions: {
      byStatus: groupBy('executions', 'status'),
      active: activeExecutions,
    },
    transcripts,
    schedules,
    devices,
    referencedAttachmentNames: referencedAttachments,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.jsonOut && path.resolve(args.jsonOut).startsWith(args.root + path.sep)) {
    throw new Error('Write the report outside the root being inventoried.');
  }
  const root = args.root;
  const configDir = path.join(root, '.config');
  const dbPath = path.join(root, 'data.db');
  const attachmentsDir = path.join(root, 'attachments');

  const db = fs.existsSync(dbPath) ? inventoryDb(dbPath, args.git) : null;
  const attachmentFiles = listDir(attachmentsDir) ?? [];
  const referenced = db?.referencedAttachmentNames ?? new Set<string>();

  const report = {
    root,
    inventoriedAt: new Date().toISOString(),
    role: fs.existsSync(dbPath) ? 'home' : 'no database',
    sizesKb: {
      dataDb: duKb(dbPath),
      attachments: duKb(attachmentsDir),
      archive: duKb(path.join(root, '.archive')),
      config: duKb(configDir),
      work: duKb(path.join(root, '.work')),
      worktrees: duKb(path.join(root, 'worktrees')),
      snapshots: duKb(path.join(root, 'snapshots')),
    },
    persona: Object.fromEntries(
      ['CLAUDE.md', 'AGENTS.md', 'MEMORY.md', 'USER.md', 'SOUL.md', 'DECK.md', 'triage-context.md'].map(
        (f) => [f, fs.existsSync(path.join(root, f))],
      ),
    ),
    skills: listDir(path.join(root, 'skills')),
    config: readConfig(configDir),
    configEntries: listDir(configDir),
    attachments: {
      filesOnDisk: attachmentFiles.length,
      referencedByRecords: referenced.size,
      referencedButMissing: [...referenced].filter((n) => !attachmentFiles.includes(n)).length,
      onDiskButUnreferenced: attachmentFiles.filter((n) => !referenced.has(n)).length,
      archiveFiles: countFiles(path.join(root, '.archive')),
    },
    database: db ? { ...db, referencedAttachmentNames: undefined } : null,
  };

  const json = JSON.stringify(report, null, 2);
  if (args.jsonOut) {
    fs.writeFileSync(args.jsonOut, json + '\n', { mode: 0o600 });
    console.error(`inventory written to ${args.jsonOut}`);
  } else {
    process.stdout.write(json + '\n');
  }
}

main();
