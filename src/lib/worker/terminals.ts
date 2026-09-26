/**
 * In-app terminals on a connected computer (docs/homes-build.md, P3.5,
 * spec §5.6). The same PTY manager the home uses, run by the worker: a shell
 * in an execution's worktree, for the placement this computer holds, or in
 * an agent's folder from this computer's own setup files. The home asks for
 * each operation as a `terminal` request, and output comes back as batches
 * the worker posts, each chunk carrying its offset so the home and a viewer
 * can tell a continuation from a gap.
 *
 * Output is never queued for a home that isn't listening: a batch that
 * can't be posted is dropped, and the ring buffer here is what a viewer
 * catches up from when it reconnects. Input is never queued either: an
 * operation arrives as a request while the computer is connected, or not at
 * all.
 */

import * as fs from 'node:fs';
import type { ReadAnswer } from '@/lib/workspaces/execution-reads';
import type { TerminalOutputBatch, TerminalRequest, TerminalScope } from '@/lib/workers/protocol';
import type { CommandJournal } from './command-journal';

/** The PTY manager's surface, so tests can supply one without a native module. */
export interface PtyHost {
  createTerminal: typeof import('@/lib/terminal/pty-manager').createTerminal;
  listTerminals: typeof import('@/lib/terminal/pty-manager').listTerminals;
  getTerminal: typeof import('@/lib/terminal/pty-manager').getTerminal;
  writeInput: typeof import('@/lib/terminal/pty-manager').writeInput;
  resizeTerminal: typeof import('@/lib/terminal/pty-manager').resizeTerminal;
  killTerminal: typeof import('@/lib/terminal/pty-manager').killTerminal;
  killAllForOwner: typeof import('@/lib/terminal/pty-manager').killAllForOwner;
  subscribe: typeof import('@/lib/terminal/pty-manager').subscribe;
}

export interface WorkerTerminalsOptions {
  journal: Pick<CommandJournal, 'preparedWorktree' | 'released' | 'highestGeneration'>;
  /** The agent's folder on this computer, from its setup files. */
  agentFolder: (agentId: string) => string | null;
  /** Post a batch to the home. A rejection drops it. */
  post: (batch: TerminalOutputBatch) => Promise<void>;
  pty?: PtyHost;
  /** How long output gathers before it's posted. */
  flushMs?: number;
}

/** Output held for one terminal between posts, capped at the ring's size: past that, the home resyncs. */
const MAX_PENDING_CHARS = 256 * 1024;

const answer = (status: number, body: unknown): ReadAnswer => ({ status, body });
const notFound = answer(404, { error: 'Terminal not found' });

function ownerOf(scope: TerminalScope): string {
  return scope.kind === 'execution' ? scope.executionId : `workspace:${scope.agentId}`;
}

export class WorkerTerminals {
  /** The placement generation each execution terminal was opened under. */
  private readonly generations = new Map<string, number>();
  private readonly unsubscribes = new Map<string, () => void>();
  /** Every owner a shell was opened for, so stopping the worker stops them all. */
  private readonly ownersSeen = new Set<string>();
  private pending = new Map<string, { data: string; offset: number }>();
  private exits: TerminalOutputBatch['exits'] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private posting = false;
  private pty: PtyHost | null;
  private readonly flushMs: number;

  constructor(private readonly options: WorkerTerminalsOptions) {
    this.pty = options.pty ?? null;
    this.flushMs = options.flushMs ?? 25;
  }

  private async host(): Promise<PtyHost> {
    // Loaded on first use: the native module isn't needed by a worker that never opens a shell.
    this.pty ??= await import('@/lib/terminal/pty-manager');
    return this.pty;
  }

  /**
   * Whether this computer may act for the scope, and where its shells start.
   * An execution needs the worktree prepared here and the placement still
   * this computer's, at this generation. An agent needs its folder set up here.
   */
  private place(scope: TerminalScope): { cwd: string } | ReadAnswer {
    if (scope.kind === 'agent') {
      const folder = this.options.agentFolder(scope.agentId);
      if (!folder) return answer(409, { error: 'not_set_up', message: "This agent isn't set up on this computer." });
      return { cwd: folder };
    }
    const { journal } = this.options;
    const newest = journal.highestGeneration(scope.executionId);
    if (journal.released(scope.executionId, scope.generation) || (newest !== null && scope.generation < newest)) {
      return answer(409, { error: 'moved', message: 'This execution no longer runs on this computer.' });
    }
    const worktree = journal.preparedWorktree(scope.executionId);
    if (!worktree) return answer(409, { error: 'not_prepared', message: "This execution isn't set up on this computer yet." });
    return { cwd: worktree };
  }

  /** A terminal of this scope, opened under the same placement. */
  private owns(scope: TerminalScope, terminalId: string): boolean {
    if (scope.kind !== 'execution') return true;
    return this.generations.get(terminalId) === scope.generation;
  }

  async handle(request: TerminalRequest): Promise<ReadAnswer> {
    const pty = await this.host();
    const placed = this.place(request.scope);
    if (!('cwd' in placed)) return placed;
    const owner = ownerOf(request.scope);
    if (request.op !== 'list' && request.op !== 'create' && !this.owns(request.scope, request.terminalId)) return notFound;

    switch (request.op) {
      case 'list':
        return answer(200, pty.listTerminals(owner).filter((t) => this.owns(request.scope, t.id)));
      case 'create': {
        if (!isDirectory(placed.cwd)) {
          return answer(409, { error: `Working directory does not exist: ${placed.cwd}`, code: 'cwd_missing' });
        }
        try {
          const created = pty.createTerminal({ ownerId: owner, cwd: placed.cwd, cols: request.cols, rows: request.rows });
          if (request.scope.kind === 'execution') this.generations.set(created.id, request.scope.generation);
          this.follow(created.id, owner);
          return answer(201, created);
        } catch (err) {
          const code = (err as { code?: string }).code ?? 'spawn_failed';
          return answer(code === 'spawn_failed' ? 500 : 409, { error: (err as Error).message, code });
        }
      }
      case 'get': {
        const t = pty.getTerminal(owner, request.terminalId);
        return t ? answer(200, t) : notFound;
      }
      case 'input':
        return pty.writeInput(owner, request.terminalId, request.data)
          ? answer(200, { ok: true })
          : answer(404, { error: 'Terminal not found or exited' });
      case 'resize':
        return pty.resizeTerminal(owner, request.terminalId, request.cols, request.rows)
          ? answer(200, { ok: true })
          : answer(404, { error: 'Terminal not found or exited' });
      case 'close': {
        this.forget(request.terminalId);
        return pty.killTerminal(owner, request.terminalId) ? answer(200, { ok: true }) : notFound;
      }
      case 'replay': {
        const result = pty.subscribe(owner, request.terminalId, () => {}, request.since);
        if (!result) return notFound;
        result.unsubscribe();
        const { replay, offset, gap, exited, exitCode } = result;
        return answer(200, { replay, offset, gap, exited, exitCode });
      }
    }
  }

  /** Stop an execution's shells here: its placement moved on (spec §5.6). */
  async releaseExecution(executionId: string): Promise<number> {
    const pty = await this.host();
    for (const t of pty.listTerminals(executionId)) this.forget(t.id);
    return pty.killAllForOwner(executionId);
  }

  /** Stop every shell this worker started, as it stops. */
  async closeAll(): Promise<void> {
    if (!this.pty) return;
    for (const [terminalId, unsubscribe] of this.unsubscribes) {
      unsubscribe();
      this.generations.delete(terminalId);
    }
    this.unsubscribes.clear();
    for (const owner of new Set([...this.ownersSeen])) this.pty.killAllForOwner(owner);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private follow(terminalId: string, owner: string): void {
    this.ownersSeen.add(owner);
    const result = this.pty!.subscribe(owner, terminalId, (chunk) => {
      if (chunk.type === 'data') this.queue(terminalId, chunk.data, chunk.offset);
      else {
        this.exits.push({ terminalId, code: chunk.code, signal: chunk.signal });
        this.generations.delete(terminalId);
        this.unsubscribes.delete(terminalId);
        this.schedule();
      }
    }, Number.MAX_SAFE_INTEGER);
    if (result) this.unsubscribes.set(terminalId, result.unsubscribe);
  }

  private forget(terminalId: string): void {
    this.unsubscribes.get(terminalId)?.();
    this.unsubscribes.delete(terminalId);
    this.generations.delete(terminalId);
    this.pending.delete(terminalId);
  }

  private queue(terminalId: string, data: string, offset: number): void {
    const held = this.pending.get(terminalId);
    let next = held ? held.data + data : data;
    // Past the ring's size the home can't splice it anyway: keep the tail,
    // and the offset tells the home to catch its viewers up from the ring.
    if (next.length > MAX_PENDING_CHARS) next = next.slice(-MAX_PENDING_CHARS);
    this.pending.set(terminalId, { data: next, offset });
    this.schedule();
  }

  private schedule(): void {
    if (this.timer || this.posting) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushMs);
    this.timer.unref?.();
  }

  private async flush(): Promise<void> {
    if (this.posting) return;
    if (this.pending.size === 0 && this.exits.length === 0) return;
    const batch: TerminalOutputBatch = {
      chunks: [...this.pending].map(([terminalId, { data, offset }]) => ({ terminalId, data, offset })),
      exits: this.exits,
    };
    this.pending = new Map();
    this.exits = [];
    this.posting = true;
    try {
      await this.options.post(batch);
    } catch {
      // Dropped. A viewer catches up from the ring when it reconnects.
    } finally {
      this.posting = false;
      if (this.pending.size > 0 || this.exits.length > 0) this.schedule();
    }
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
