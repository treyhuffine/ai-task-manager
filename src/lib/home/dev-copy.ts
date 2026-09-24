/**
 * Turn a restored copy of a home into a development copy that cannot act on
 * the original (docs/homes-spec.md §10.4): "assign development authority and
 * credentials, and disable inherited schedules, connectors, and other
 * outward actions before its first normal boot."
 *
 * A restored copy still holds everything that points back at the original:
 *
 * - **Credentials and address.** The host token, every paired device's key,
 *   and the tunnel name. Booting it would answer on production's address or
 *   accept production's phones.
 * - **Outward actions.** Schedules, connector credentials, notification
 *   channels, and web push subscriptions reach real services and devices.
 * - **Native sessions.** A chat's `external_session_id` resumes a harness
 *   conversation by id. Claude Code finds a session by id from any folder,
 *   so the copy's first message would append to production's transcript.
 * - **Folders.** Agents, executions and reference folders hold absolute paths
 *   to production checkouts and worktrees. Provisioning, continuing, or a
 *   setup script there would change production's repositories.
 *
 * - **Identity.** A development copy is a different home. It gets a new home
 *   id and a new host computer (this machine, written to its own
 *   `machine.json`), and the original's computers are revoked in the copy.
 *
 * This clears the first three and detaches every folder path by moving it
 * under `<root>/.detached/`, where it does not exist. Every folder action in
 * the copy then fails as "folder missing" instead of touching the original,
 * and the original path stays readable inside the detached one.
 *
 * Only ever run it on a copy. `scripts/home-backup.ts dev-copy` refuses the
 * production, default dev, and test roots before calling it.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { uuidv7 } from 'uuidv7';
import { canonicalPath } from '@/lib/config/canonical-path';
import { machineFingerprint } from './machine-fingerprint';

export const DETACHED_DIR = '.detached';

/** Config keys reset in a development copy, and the value each gets. */
const CONFIG_RESETS: Record<string, unknown> = {
  localToken: null,
  tunnelUrl: null,
  tunnelName: null,
  autoTunnel: false,
  staticUrl: null,
  lastPort: null,
  globalSkillEnabled: false,
};

/** `.config` entries removed from a development copy: outward credentials. */
const CONFIG_REMOVED = ['connectors', 'notifications', 'agents', 'sources'];

export interface DevCopyReport {
  root: string;
  /** The copy's new home id, when the copy has a home identity. */
  homeId: string | null;
  config: string[];
  removed: string[];
  database: Record<string, number>;
}

export function detachedPath(root: string, original: string): string {
  if (original.startsWith(path.join(root, DETACHED_DIR) + path.sep)) return original;
  return path.join(root, DETACHED_DIR, original);
}

export function prepareDevelopmentCopy(root: string): DevCopyReport {
  root = path.resolve(root);
  const dbPath = path.join(root, 'data.db');
  if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath}.`);

  const report: DevCopyReport = { root, homeId: null, config: [], removed: [], database: {} };

  const configFile = path.join(root, '.config', 'config.json');
  if (fs.existsSync(configFile)) {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Record<string, unknown>;
    for (const [key, value] of Object.entries(CONFIG_RESETS)) {
      if (config[key] !== value) {
        config[key] = value;
        report.config.push(key);
      }
    }
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  }
  for (const name of CONFIG_REMOVED) {
    const p = path.join(root, '.config', name);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
      report.removed.push(path.join('.config', name));
    }
  }

  // Assigned inside the transaction callback, so hold it in an object that
  // TypeScript doesn't narrow back to null.
  const identity: { value: { homeId: string; computerId: string } | null } = { value: null };
  const db = new Database(dbPath);
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );
    const columns = (t: string) =>
      new Set((db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name));
    const has = (t: string, ...cols: string[]) => {
      if (!tables.has(t)) return false;
      const present = columns(t);
      return cols.every((c) => present.has(c));
    };
    const run = (label: string, sql: string, ...params: unknown[]) => {
      report.database[label] = db.prepare(sql).run(...params).changes;
    };
    const now = new Date().toISOString();
    const detach = (table: string, column: string) => {
      if (!has(table, column)) return;
      const rows = db
        .prepare(`SELECT rowid AS rid, "${column}" AS p FROM "${table}" WHERE "${column}" IS NOT NULL`)
        .all() as { rid: number; p: string }[];
      const update = db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE rowid = ?`);
      let n = 0;
      for (const r of rows) {
        if (!path.isAbsolute(r.p)) continue;
        const next = detachedPath(root, r.p);
        if (next !== r.p) {
          update.run(next, r.rid);
          n++;
        }
      }
      report.database[`${table}.${column} detached`] = n;
    };

    db.transaction(() => {
      if (has('api_keys', 'revoked_at', 'revoked_reason')) {
        run(
          'api_keys revoked',
          'UPDATE api_keys SET revoked_at = ?, revoked_reason = ? WHERE revoked_at IS NULL',
          now,
          'development copy',
        );
      }
      if (has('triggers', 'enabled')) {
        run('triggers disabled', 'UPDATE triggers SET enabled = 0 WHERE enabled = 1');
      }
      if (has('notification_channels', 'enabled')) {
        run('notification channels disabled', 'UPDATE notification_channels SET enabled = 0 WHERE enabled = 1');
      }
      if (tables.has('web_push_subscriptions')) {
        run('web push subscriptions removed', 'DELETE FROM web_push_subscriptions');
      }
      if (has('chat_sessions', 'external_session_id', 'external_transcript_path')) {
        run(
          'chat native sessions detached',
          `UPDATE chat_sessions SET external_session_id = NULL, external_transcript_path = NULL
            WHERE external_session_id IS NOT NULL OR external_transcript_path IS NOT NULL`,
        );
      }
      if (tables.has('home') && tables.has('computers')) {
        const original = db.prepare('SELECT id, name FROM home').get() as { id: string; name: string } | undefined;
        if (original) {
          const homeId = uuidv7();
          const computerId = uuidv7();
          run(
            'computers revoked',
            "UPDATE computers SET status = 'revoked', revoked_at = ? WHERE status = 'active'",
            now,
          );
          db.prepare(
            `INSERT INTO computers (id, created_at, updated_at, name, platform, hostname, status)
             VALUES (?, ?, ?, ?, ?, ?, 'active')`,
          ).run(computerId, now, now, os.hostname().replace(/\.local$/, ''), process.platform, os.hostname());
          db.prepare('UPDATE home SET id = ?, name = ?, host_computer_id = ?, updated_at = ?').run(
            homeId,
            original.name.endsWith(' (dev copy)') ? original.name : `${original.name} (dev copy)`,
            computerId,
            now,
          );
          report.homeId = homeId;
          identity.value = { homeId, computerId };
        }
      }
      detach('workspaces', 'cwd');
      detach('workspaces', 'worktree_root');
      detach('executions', 'worktree_path');
      detach('reference_folders', 'path');
      detach('external_session_imports', 'source_path');
    })();
  } finally {
    db.close();
  }
  if (identity.value) {
    const file = path.join(root, '.config', 'machine.json');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          version: 1,
          ...identity.value,
          createdAt: new Date().toISOString(),
          machine: machineFingerprint(),
          root: canonicalPath(root),
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
  }
  return report;
}
