#!/usr/bin/env tsx
/**
 * One-shot backfill: bring already-imported provider transcripts out of the
 * archive.
 *
 * The importer used to land every session as `status: 'archived'` on the theory
 * that a finished transcript isn't live work. The practical effect was that an
 * import went somewhere you couldn't see: archived executions are absent from
 * the workspace tree and from every active-only list, so the only way back to
 * one was to already know a keyword to search for. Importing is an explicit
 * "bring this into the app" action, so the result now lands active.
 *
 * This fixes up the rows created before that change. Idempotent — re-running
 * finds nothing to do.
 *
 * Caveat worth knowing before you run it: an imported chat you archived *on
 * purpose* is indistinguishable from one the importer archived. Both carry
 * `archived_at` set to the transcript's own timestamp, because archiving bumps
 * `updated_at` to match. So this un-archives all of them, and anything you
 * wanted filed away has to be archived again. With a young feature and a
 * handful of rows that's the right trade; if it isn't, run --dry-run and decide.
 *
 * Usage:
 *   pnpm unarchive:imports --dry-run              # preview (prod home ~/<app>)
 *   pnpm unarchive:imports                        # apply
 *   FLOW_ROOT=~/flow-dev pnpm unarchive:imports   # against the dev home
 */

import pc from 'picocolors';
import { getRawDb } from '../src/lib/db';
import { getAppRoot, getDbPath } from '../src/lib/config/paths';

interface ArchivedImport {
  id: string;
  execution_id: string | null;
  label: string | null;
  provider: string | null;
  workspace: string | null;
}

function main() {
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');

  console.log(pc.bold(`Un-archive imported chats${dryRun ? pc.yellow(' (dry run)') : ''}`));
  console.log(pc.dim(`  home: ${getAppRoot()}`));
  console.log(pc.dim(`  db:   ${getDbPath()}`));
  console.log();

  const db = getRawDb();

  // `imported_agent` is the importer's own marker, and the ledger join proves
  // the row came from an import rather than merely resembling one.
  const rows = db
    .prepare(`
      SELECT cs.id, cs.execution_id, cs.label, cs.surface_ref AS provider, w.name AS workspace
      FROM external_session_imports i
      JOIN chat_sessions cs ON cs.id = i.chat_session_id
      LEFT JOIN workspaces w ON w.id = cs.workspace_id
      WHERE cs.surface_kind = 'imported_agent' AND cs.status = 'archived'
      ORDER BY w.name, cs.updated_at DESC
    `)
    .all() as ArchivedImport[];

  if (rows.length === 0) {
    console.log(pc.green('  Nothing to do — no archived imports.'));
    return;
  }

  for (const row of rows) {
    const where = pc.dim(`${row.workspace ?? '(no workspace)'} · ${row.provider ?? '?'} ·`);
    console.log(`  ${where} ${row.label ?? '(no label)'}`);
  }
  console.log();
  console.log(`  ${pc.bold(String(rows.length))} archived import${rows.length === 1 ? '' : 's'}`);

  if (dryRun) {
    console.log(pc.yellow('  Dry run — nothing written.'));
    return;
  }

  const sessionIds = rows.map((r) => r.id);
  const executionIds = rows.map((r) => r.execution_id).filter((id): id is string => !!id);

  const bumpSession = db.prepare(
    `UPDATE chat_sessions SET status = 'active', archived_at = NULL WHERE id = ?`,
  );
  const bumpExecution = db.prepare(
    `UPDATE executions SET status = 'active', archived_at = NULL WHERE id = ?`,
  );

  // One transaction: an execution left archived while its chat is active is a
  // half-state the UI has no story for (the tree reads the execution, the chat
  // list reads the session), so both flip or neither does.
  db.transaction(() => {
    for (const id of sessionIds) bumpSession.run(id);
    for (const id of executionIds) bumpExecution.run(id);
  })();

  console.log(
    pc.green(`  Un-archived ${sessionIds.length} chat(s) and ${executionIds.length} execution(s).`),
  );
  console.log(pc.dim('  Reload the app to pick this up.'));
}

main();
