/**
 * Global test sandbox: point the app home at a throwaway temp dir before any
 * test code runs. Without this, a test that sandboxes only the DB
 * (`RI_DB_PATH`) still leaks side-channel writes into the real prod home —
 * the markdown mirror resolves through `getAppRoot()`, which falls back to
 * `~/<APP_SHORT_ID>` when `<APP>_ROOT` is unset. That is exactly how test
 * fixtures ended up exported into the production mirror (2026-09-11).
 *
 * Tests that need a specific home still win: this only fills the var when
 * the runner didn't provide one, and per-test assignments happen after setup.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_ROOT_ENV } from '@/lib/config/paths';

if (!process.env[APP_ROOT_ENV]) {
  process.env[APP_ROOT_ENV] = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-vitest-root-'));
}
