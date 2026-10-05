/**
 * The work ledger: every chat's work blocks, kept in one JSON file under the
 * home's work dir (docs/work-view.md, "Storage"). A trial store, so no
 * migration: the file is derived data, rebuilt from chat_events whenever it's
 * missing, unreadable or from an older algorithm.
 *
 * Kept current lazily but incrementally. Each read first folds in the
 * chat_events rows added since the last pass (by rowid, so an imported
 * transcript's old timestamps aren't missed), which is a handful of rows
 * between two looks at the calendar. The first build walks the whole table in
 * chunks, yielding between them, so the server keeps answering meanwhile.
 *
 * One process owns the home (the owner lock), so a module-level promise
 * chain is enough to keep passes from overlapping.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkDir } from '@/lib/config/paths';
import { listWorkEventsAfterRowid, listWorkEventsForSession, type WorkEventRow } from '@/lib/db/queries';
import { normalizeTimestamp } from '@/lib/utils/timestamps';
import { countWords, extendBlocks, type LedgerBlock, type WorkEvent } from './model';

/** Bump when the block rules change: the file rebuilds from scratch. */
const LEDGER_VERSION = 1;
const CHUNK_ROWS = 20_000;

interface LedgerFile {
  version: number;
  /** The last chat_events rowid folded in. */
  cursor: number;
  blocks: LedgerBlock[];
}

export function ledgerPath(): string {
  return path.join(getWorkDir(), 'work-ledger.json');
}

let memory: { cursor: number; bySession: Map<string, LedgerBlock[]> } | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** Fold in what's new, then return every block. */
export function readLedger(): Promise<LedgerBlock[]> {
  const run = chain.then(update, update);
  chain = run.catch(() => undefined);
  return run;
}

function toEvent(row: WorkEventRow): WorkEvent | null {
  const at = Date.parse(normalizeTimestamp(row.createdAt));
  if (!Number.isFinite(at)) return null;
  return {
    sessionId: row.sessionId,
    at,
    source: row.source,
    fromOtherChat: row.senderSessionId != null,
    words: row.text ? countWords(row.text) : 0,
  };
}

async function load(): Promise<{ cursor: number; bySession: Map<string, LedgerBlock[]> }> {
  if (memory) return memory;
  let file: LedgerFile | null = null;
  try {
    const parsed = JSON.parse(await fs.readFile(ledgerPath(), 'utf8')) as LedgerFile;
    if (parsed.version === LEDGER_VERSION && Array.isArray(parsed.blocks)) file = parsed;
  } catch {
    // Missing or unreadable: rebuild from chat_events.
  }
  const bySession = new Map<string, LedgerBlock[]>();
  for (const b of file?.blocks ?? []) {
    const list = bySession.get(b.sessionId) ?? [];
    list.push(b);
    bySession.set(b.sessionId, list);
  }
  for (const list of bySession.values()) list.sort((a, b) => a.start - b.start);
  memory = { cursor: file?.cursor ?? 0, bySession };
  return memory;
}

async function update(): Promise<LedgerBlock[]> {
  const state = await load();
  let changed = false;
  // A chat rebuilt from all its events already holds rows up to this rowid.
  const rebuiltThrough = new Map<string, number>();

  for (;;) {
    const rows = listWorkEventsAfterRowid(state.cursor, CHUNK_ROWS);
    if (rows.length === 0) break;
    const bySession = new Map<string, WorkEvent[]>();
    for (const row of rows) {
      if ((rebuiltThrough.get(row.sessionId) ?? -1) >= row.rowid) continue;
      const ev = toEvent(row);
      if (!ev) continue;
      const list = bySession.get(ev.sessionId) ?? [];
      list.push(ev);
      bySession.set(ev.sessionId, list);
    }
    for (const [sessionId, events] of bySession) {
      events.sort((a, b) => a.at - b.at);
      const next = extendBlocks(state.bySession.get(sessionId) ?? [], events);
      if (next) {
        state.bySession.set(sessionId, next);
      } else {
        // Older history arrived (an import): rebuild this chat from all of it.
        const all = listWorkEventsForSession(sessionId);
        const rebuilt = extendBlocks([], all.map(toEvent).filter((e): e is WorkEvent => e !== null).sort((a, b) => a.at - b.at));
        state.bySession.set(sessionId, rebuilt ?? []);
        rebuiltThrough.set(sessionId, all.reduce((max, r) => Math.max(max, r.rowid), 0));
      }
    }
    state.cursor = rows[rows.length - 1]!.rowid;
    changed = true;
    if (rows.length < CHUNK_ROWS) break;
    // Let requests through between chunks of a first build.
    await new Promise((resolve) => setImmediate(resolve));
  }

  const blocks = [...state.bySession.values()].flat();
  if (changed) await write({ version: LEDGER_VERSION, cursor: state.cursor, blocks });
  return blocks;
}

async function write(file: LedgerFile): Promise<void> {
  const target = ledgerPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file));
  await fs.rename(tmp, target);
}

/** Tests: forget the in-memory copy so the next read loads the file. */
export function resetLedgerMemory(): void {
  memory = null;
}
