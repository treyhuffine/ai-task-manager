/**
 * `processState` is one value per process, and server code keeps state that
 * must agree across bundles there. The second half is a ratchet: it lists
 * every remaining module-level mutable variable in server code (a `let`, or an
 * empty Map/Set/WeakMap/WeakSet) with the reason its copies may disagree.
 * Next loads server code once per bundle, so a new one fails until it moves
 * to `processState` or is added here with its reason.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('processState', () => {
  it('returns one value per process to every copy of a module', async () => {
    const first = await import('./process-state');
    const a = first.processState('test.shared', () => ({ hits: 0 }));
    a.hits++;
    vi.resetModules();
    const second = await import('./process-state');
    expect(second).not.toBe(first);
    expect(second.processState('test.shared', () => ({ hits: 0 })).hits).toBe(1);
  });

  it('initializes each name once', async () => {
    const { processState } = await import('./process-state');
    const init = vi.fn(() => new Map<string, number>());
    expect(processState('test.once', init)).toBe(processState('test.once', init));
    expect(init).toHaveBeenCalledTimes(1);
  });
});

const ROOT = path.resolve(__dirname, '../..');
const SERVER = ['src/lib', 'src/service', 'src/app/api', 'src/proxy.ts', 'instrumentation.ts'];
/** Browser code (no server bundles to split across) and the service controller (its own process). */
const NOT_SERVER = ['src/lib/client/', 'src/lib/query/', 'src/lib/api/', 'src/lib/_debug/', 'src/service/main.ts'];
const DECLARATION = /^(?:export\s+)?(?:let\s+(\w+)|const\s+(\w+)\s*(?::[^=]+)?=\s*new\s+(?:Map|Set|WeakMap|WeakSet)\s*(?:<[^()]*>)?\(\s*\))/;

/** Module-level state whose copies may safely disagree, and why. */
const PER_COPY: Record<string, string> = {
  'src/lib/db/index.ts:wrapper': 'per copy by design: Drizzle wrapper over the shared connection',
  'src/app/api/webhooks/pebble/route.ts:inFlightRecordings': 'one route, one bundle',
  'src/lib/auth/auto-tunnel.ts:started': 'startup: only instrumentation starts it',
  'src/lib/auth/auto-tunnel.ts:lastFailureCode': 'startup: only instrumentation starts it',
  'src/lib/export/mirror/init.ts:initialized': 'startup: only instrumentation starts it',
  'src/lib/export/mirror/timer.ts:handle': 'startup: only instrumentation starts it',
  'src/lib/preview/service.ts:idleLoopStarted': 'startup: only instrumentation starts it',
  'src/lib/preview/shutdown.ts:installed': 'startup: only instrumentation installs it',
  'src/lib/scheduler/runner.ts:shutdownHooksInstalled': 'startup: scheduler state itself is process-wide',
  'src/lib/preview/providers/index.ts:registered': 'registers into the process-wide provider registry, idempotently',
  'src/lib/deck/calendar.ts:provider': 'every reader calls ensureCalendarProvider() first',
  'src/lib/triage/llm.ts:providerInitialized': 'lazy setup, safe to repeat per copy',
  'src/lib/auth/host-key.ts:cache': 'cache: keyed by file path and mtime',
  'src/lib/integrations/write-policy.ts:cache': 'cache: keyed by file path and mtime',
  'src/lib/calendar/service.ts:cache': 'cache: TTL',
  'src/lib/harness/model-discovery.ts:cache': 'cache: TTL',
  'src/lib/harness/runtime.ts:cache': 'cache: TTL',
  'src/lib/reference-folders/resolve.ts:gitCache': 'cache: TTL',
  'src/lib/preview/portless.ts:detectCache': 'cache: TTL',
  'src/lib/orchestrator/claude-agents-md.ts:cached': 'cache: TTL',
  'src/lib/worker/history.ts:listing': 'cache: TTL',
  'src/lib/config/tls-x509.ts:cached': 'cache: a loaded module',
  'src/lib/preview/beamd/cli.ts:cachedBinInfo': 'cache: a binary probe',
  'src/lib/home/machine-fingerprint.ts:cached': 'cache: this machine never changes',
  'src/lib/home/machine-fingerprint.ts:override': 'test seam',
  'src/lib/home/portable.ts:cached': 'cache: a filesystem probe',
  'src/lib/home/identity.ts:verified': 'cache: re-verified when the database path changes',
  'src/lib/integrations/runtime.ts:mcpStoreCached': 'cache: a file-backed store, interchangeable per copy',
  'src/lib/integrations/storage.ts:ready': 'cache: directories already created',
  'src/lib/notifications/web-push/vapid.ts:cached': 'cache: keys read from disk',
  'src/lib/releases/runtime-identity.ts:identities': 'cache: per runtime path',
  'src/lib/workspaces/index.ts:cached': 'cache: one agentex workspace handle',
  'src/lib/work/commits.ts:cache': 'cache: TTL',
  'src/lib/work/commits.ts:emails': 'cache: git identities',
  'src/lib/pricing/models.ts:warnedUnknownModels': 'log dedupe only',
  'src/lib/skills/manage.ts:sessionControlOverride': 'test seam',
  'src/lib/service/runtime-job.ts:owner': 'controller process only',
  'src/lib/service/runtime-job.ts:stopping': 'controller process only',
  'src/lib/worker/agent-folder.ts:book': 'worker process only',
  'src/lib/worker/agent-folder.ts:bookHome': 'worker process only',
  'src/lib/trpc/transport-state.ts:watching': 'browser',
  'src/lib/trpc/transport-state.ts:memoryMode': 'browser',
  'src/lib/trpc/transport-state.ts:status': 'browser',
  'src/lib/executions/pending-launch.ts:pending': 'browser',
  // Open: copies can each hold the ledger and queue writes to the same
  // file. Move to processState when the work-view trial settles.
  'src/lib/work/ledger.ts:memory': 'open: should be process-wide',
  'src/lib/work/ledger.ts:chain': 'open: should be process-wide',
};

function serverFiles(): string[] {
  const files: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(ROOT, rel);
    if (fs.statSync(abs).isFile()) {
      files.push(rel);
      return;
    }
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(child);
    }
  };
  for (const rel of SERVER) walk(rel);
  return files.filter((f) => !NOT_SERVER.some((prefix) => f.startsWith(prefix)));
}

function moduleState(): string[] {
  const found: string[] = [];
  for (const file of serverFiles()) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (/^\s*['"]use client['"]/.test(source)) continue;
    for (const line of source.split('\n')) {
      const match = DECLARATION.exec(line);
      if (match) found.push(`${file}:${match[1] ?? match[2]}`);
    }
  }
  return found.sort();
}

describe('module-level state in server code', () => {
  const found = moduleState();

  it('is process-wide, or listed with why its copies may disagree', () => {
    const unlisted = found.filter((entry) => !(entry in PER_COPY));
    expect(
      unlisted,
      'Next loads server code once per bundle, so this state would exist once per copy. ' +
        'Keep it in processState (src/lib/process-state.ts), or add it to PER_COPY with the reason copies may disagree.',
    ).toEqual([]);
  });

  it('lists nothing that no longer exists', () => {
    expect(Object.keys(PER_COPY).filter((entry) => !found.includes(entry))).toEqual([]);
  });
});
