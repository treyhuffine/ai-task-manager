/**
 * Global test sandbox: point the app home at a throwaway temp dir before any
 * test code runs. Without this, a test that sandboxes only the DB
 * (`RI_DB_PATH`) still leaks side-channel writes into the real prod home —
 * the markdown mirror resolves through `getAppRoot()`, which falls back to
 * `~/<APP_SHORT_ID>` when `<APP>_ROOT` is unset. That is exactly how test
 * fixtures ended up exported into the production mirror (2026-09-11).
 *
 * Always a fresh one, whatever the shell running the tests has set. Under
 * `pnpm iso`, the launcher sets the root, database, config and work paths to
 * that instance's, and a test that sets only the root would otherwise read
 * and write that instance's database and config (and seven tests failed
 * there for it, P2 review). Tests that need a specific home set it
 * themselves, after this runs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_ROOT_ENV, BRAIN_PATH_ENV, CONFIG_DIR_ENV, DB_PATH_ENV, WORK_DIR_ENV } from '@/lib/config/paths';

process.env[APP_ROOT_ENV] = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-vitest-root-'));
for (const name of [DB_PATH_ENV, CONFIG_DIR_ENV, WORK_DIR_ENV, BRAIN_PATH_ENV]) delete process.env[name];

/**
 * No test reaches a real server on this machine. A call to the app's own
 * server (`serverFetch`, the CLI's self-calls) falls back to port 4224 when
 * nothing says otherwise, and on a machine that runs Ri, production answers
 * there. Point those calls at the discard port, where nothing listens, so an
 * unmocked self-call fails at once instead of reaching production. Tests
 * that start their own server pass its address explicitly.
 */
if (!process.env.PORT) {
  process.env.PORT = '9';
}
