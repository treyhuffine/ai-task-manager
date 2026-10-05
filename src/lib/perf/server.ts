/**
 * Start the server's perf log (docs/server-perf-log.md): time every
 * better-sqlite3 statement in the process, then start the recorder.
 *
 * Kept apart from ./recorder.ts so the scope API never loads better-sqlite3:
 * the runner and worker open scopes too, and reach no database.
 */
import { recordStatement, startPerfRecorder } from './recorder';
import { instrumentSqlite } from './sqlite';

export function startServerPerfLog(options: Parameters<typeof startPerfRecorder>[0] = {}): void {
  try {
    instrumentSqlite(recordStatement);
  } catch (err) {
    console.warn('[perf] statements not timed:', err instanceof Error ? err.message : err);
  }
  startPerfRecorder(options);
}
