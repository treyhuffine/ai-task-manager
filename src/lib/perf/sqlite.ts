/**
 * Time every better-sqlite3 statement in this process, for the perf log.
 *
 * Patches the shared Statement prototype (`run`, `get`, `all`, `iterate`) and
 * `Database#exec` once per process, so Drizzle, raw `prepare` and pragma calls
 * are all covered on every connection without changing how any is opened.
 * The cost is two `performance.now()` calls per statement. Each wrapper calls
 * the original exactly as before and reports after it returns or throws.
 */
import Database from 'better-sqlite3';
import { performance } from 'node:perf_hooks';

type Reporter = (sql: string, ms: number, rows?: number) => void;
type Methods = { [name: string]: unknown };
type AnyFn = (this: unknown, ...args: unknown[]) => unknown;

const PATCHED = Symbol.for('ri.perf.sqlite');

export function instrumentSqlite(record: Reporter): void {
  const g = globalThis as typeof globalThis & { [PATCHED]?: true };
  if (g[PATCHED]) return;
  const probe = new Database(':memory:');
  try {
    const statement = Object.getPrototypeOf(probe.prepare('SELECT 1')) as Methods;
    for (const name of ['run', 'get', 'all'] as const) wrapCall(statement, name, record);
    wrapIterate(statement, record);
    wrapExec(Database.prototype as unknown as Methods, record);
  } finally {
    probe.close();
  }
  g[PATCHED] = true;
}

function wrapCall(proto: Methods, name: 'run' | 'get' | 'all', record: Reporter): void {
  const original = proto[name] as AnyFn;
  proto[name] = function (this: Database.Statement, ...args: unknown[]) {
    const started = performance.now();
    let result: unknown;
    try {
      result = original.apply(this, args);
      return result;
    } finally {
      record(this.source, performance.now() - started, Array.isArray(result) ? result.length : undefined);
    }
  };
}

/** `iterate` does its work in each `next()`, so time those and report once. */
function wrapIterate(proto: Methods, record: Reporter): void {
  const original = proto.iterate as AnyFn;
  proto.iterate = function (this: Database.Statement, ...args: unknown[]) {
    const source = this.source;
    let ms = 0;
    let rows = 0;
    let reported = false;
    const report = () => {
      if (reported) return;
      reported = true;
      record(source, ms, rows);
    };
    const timed = <T>(fn: () => T): T => {
      const started = performance.now();
      try {
        return fn();
      } finally {
        ms += performance.now() - started;
      }
    };
    let iterator: IterableIterator<unknown>;
    try {
      iterator = timed(() => original.apply(this, args) as IterableIterator<unknown>);
    } catch (err) {
      report();
      throw err;
    }
    const wrapped: IterableIterator<unknown> = {
      next() {
        let step: IteratorResult<unknown>;
        try {
          step = timed(() => iterator.next());
        } catch (err) {
          report();
          throw err;
        }
        if (step.done) report();
        else rows++;
        return step;
      },
      return(value?: unknown) {
        const step = timed(() => iterator.return?.(value) ?? { done: true as const, value });
        report();
        return step;
      },
      [Symbol.iterator]() {
        return this;
      },
    };
    return wrapped;
  };
}

function wrapExec(proto: Methods, record: Reporter): void {
  const original = proto.exec as AnyFn;
  proto.exec = function (this: Database.Database, ...args: unknown[]) {
    const started = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      record(String(args[0] ?? ''), performance.now() - started);
    }
  };
}
