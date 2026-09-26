/**
 * The runner and the worker never read the database, notify, or publish to
 * the realtime bus (docs/homes-build.md, P2.1 and P2.2): they run on a
 * connected computer, which has none of those. This walks their real import
 * graph, through every module they reach, and fails with the chain that
 * crosses the line.
 *
 * Type-only imports are erased at runtime, so they don't count.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../..');
const RUNNER = path.join(SRC, 'lib', 'runner');

/** Modules the runner must never load, by path under src, or by package name. */
const FORBIDDEN_PATHS = ['lib/db/', 'db/', 'lib/realtime/', 'lib/notifications/'].map((p) => path.join(SRC, p));
const FORBIDDEN_PACKAGES = ['better-sqlite3', 'drizzle-orm'];

const IMPORT_RE =
  /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/') ? path.join(SRC, specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Runtime imports of one file: local files resolved, packages by name. */
function runtimeImports(file: string): { local: string[]; packages: string[] } {
  const source = fs.readFileSync(file, 'utf8');
  const local: string[] = [];
  const packages: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const typeOnly = Boolean(match[2]);
    const specifier = match[3] ?? match[4];
    if (!specifier || typeOnly) continue;
    if (specifier.startsWith('.') || specifier.startsWith('@/')) {
      const resolved = resolveLocal(file, specifier);
      if (resolved) local.push(resolved);
    } else {
      packages.push(specifier);
    }
  }
  return { local, packages };
}

/**
 * What a worker must never load on top of that (P3.6, spec §7): the home is
 * the one scheduler and the one deck generator, so a connected computer
 * reaches neither the scheduler nor the deck and its AI pipeline.
 */
const WORKER_FORBIDDEN_PATHS = ['lib/scheduler/', 'lib/deck/', 'lib/ai/', 'lib/runs/'].map((p) => path.join(SRC, p));

/** Every forbidden module the file reaches, with the chain that reaches it. */
function violations(entry: string, forbidden: string[] = FORBIDDEN_PATHS): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const queue: { file: string; chain: string[] }[] = [{ file: entry, chain: [entry] }];
  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const { local, packages } = runtimeImports(file);
    for (const pkg of packages) {
      if (FORBIDDEN_PACKAGES.some((p) => pkg === p || pkg.startsWith(`${p}/`))) {
        found.push([...chain, pkg].map((f) => path.relative(SRC, f) || f).join(' → '));
      }
    }
    for (const next of local) {
      if (forbidden.some((p) => next.startsWith(p))) {
        found.push([...chain, next].map((f) => path.relative(SRC, f)).join(' → '));
        continue;
      }
      queue.push({ file: next, chain: [...chain, next] });
    }
  }
  return found;
}

function modulesIn(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => path.join(dir, f));
}

const runnerFiles = modulesIn(RUNNER);
/** The worker's side of the connection, and the protocol both sides share. */
const workerFiles = [...modulesIn(path.join(SRC, 'lib', 'worker')), path.join(SRC, 'lib', 'workers', 'protocol.ts')];

describe('the runner boundary', () => {
  it('covers every runner module', () => {
    expect(runnerFiles.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining(['local-runner.ts', 'live-state.ts', 'pending.ts', 'parse.ts', 'types.ts']),
    );
  });

  it.each(runnerFiles.map((f) => [path.basename(f), f]))('%s reaches no database, notification or realtime module', (_name, file) => {
    expect(violations(file)).toEqual([]);
  });

  it.each(workerFiles.map((f) => [path.relative(path.join(SRC, 'lib'), f), f]))('worker module %s reaches none either', (_name, file) => {
    expect(violations(file)).toEqual([]);
  });

  it.each(workerFiles.map((f) => [path.relative(path.join(SRC, 'lib'), f), f]))(
    'worker module %s reaches no scheduler, deck, AI pipeline or scheduled run (P3.6)',
    (_name, file) => {
      expect(violations(file, WORKER_FORBIDDEN_PATHS)).toEqual([]);
    },
  );

  it('catches a module that crosses the line', () => {
    // The walker itself: the home's sink writes the database, so it must fail.
    const sink = path.join(SRC, 'lib', 'executor', 'home-sink.ts');
    expect(violations(sink).length).toBeGreaterThan(0);
  });
});
