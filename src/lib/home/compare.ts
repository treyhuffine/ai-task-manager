/**
 * What one home has that another doesn't (docs/homes-spec.md §10.2, P5.1):
 * the first step of consolidating two homes, before anything is imported.
 * Reads both without writing to either (`source-db.ts`), a running home
 * included, and a backup the same as a root, since a backup has a root's
 * layout.
 *
 * For each kind of record it says what's in both (the same thing, by id,
 * unchanged or changed on one side since), what's only in one, and which of
 * those look like the same thing made twice (the same title, name or text).
 * Then the files: attachments, and the persona and memory files. Homes on
 * different schemas are compared on the columns both have.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { withSourceDatabase } from './source-db';

type Row = Record<string, unknown>;

interface KindSpec {
  kind: string;
  table: string;
  /** What makes two records look like the same thing, when their ids differ. Null: ids only. */
  likeness: ((row: Row) => string | null) | null;
  /** How a person recognizes it in a list. */
  title: (row: Row) => string;
  /** Columns read for likeness and title, when present. */
  columns: string[];
}

const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const norm = (v: unknown) => text(v).toLowerCase().replace(/\s+/g, ' ').trim();
const digest = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 16);
const excerpt = (v: unknown, n = 80) => {
  const t = text(v).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const nonEmpty = (s: string) => (s ? s : null);

export const KINDS: KindSpec[] = [
  { kind: 'areas', table: 'areas', columns: ['name'], likeness: (r) => nonEmpty(norm(r.name)), title: (r) => text(r.name) },
  { kind: 'tasks', table: 'tasks', columns: ['title'], likeness: (r) => nonEmpty(norm(r.title)), title: (r) => text(r.title) },
  {
    kind: 'notes',
    table: 'notes',
    columns: ['title', 'body'],
    likeness: (r) => (norm(r.title) ? `t:${norm(r.title)}` : norm(r.body) ? `b:${digest(norm(r.body))}` : null),
    title: (r) => (text(r.title) ? text(r.title) : excerpt(r.body)),
  },
  { kind: 'stream', table: 'stream', columns: ['raw_text'], likeness: (r) => (norm(r.raw_text) ? digest(norm(r.raw_text)) : null), title: (r) => excerpt(r.raw_text) },
  { kind: 'agents', table: 'workspaces', columns: ['name', 'cwd'], likeness: (r) => nonEmpty(norm(r.name)), title: (r) => `${text(r.name)} (${text(r.cwd)})` },
  { kind: 'executions', table: 'executions', columns: ['label', 'workspace_id'], likeness: null, title: (r) => text(r.label) || '(unlabeled)' },
  { kind: 'chats', table: 'chat_sessions', columns: ['label', 'type'], likeness: null, title: (r) => text(r.label) || `(${text(r.type)})` },
  { kind: 'schedules', table: 'triggers', columns: ['name'], likeness: (r) => nonEmpty(norm(r.name)), title: (r) => text(r.name) },
  { kind: 'linked folders', table: 'reference_folders', columns: ['alias'], likeness: (r) => nonEmpty(norm(r.alias)), title: (r) => `@${text(r.alias)}` },
];

export interface RecordRef {
  id: string;
  title: string;
  status: string | null;
  updatedAt: string | null;
}

export interface KindComparison {
  kind: string;
  /** Rows on each side. Null when that home has no such table. */
  counts: { a: number | null; b: number | null };
  /** The same records, by id. */
  inBoth: { unchanged: number; newerInA: RecordRef[]; newerInB: RecordRef[] };
  onlyInA: RecordRef[];
  onlyInB: RecordRef[];
  /** Records only in B that look like one in A: the same thing, made on each side. */
  onlyInBLikeA: Array<{ b: RecordRef; a: RecordRef }>;
  onlyInALikeB: Array<{ a: RecordRef; b: RecordRef }>;
}

export interface FileComparison {
  onlyInA: string[];
  onlyInB: string[];
  differ: string[];
  same: number;
}

export interface HomeComparison {
  a: HomeSide;
  b: HomeSide;
  /** Share of A's records whose ids B also has: near 0 for two homes started apart, high for one copied from the other. */
  sharedIdShare: number;
  kinds: KindComparison[];
  /** Chats in both whose conversations have events on one side the other lacks. */
  chatHistory: { chatsInBoth: number; moreInA: Array<{ id: string; title: string; a: number; b: number }>; moreInB: Array<{ id: string; title: string; a: number; b: number }> };
  attachments: FileComparison;
  persona: FileComparison;
  skills: FileComparison;
  skillDrafts: FileComparison;
}

export interface HomeSide {
  root: string;
  homeId: string | null;
  homeName: string | null;
  migrations: number;
  latestMigration: string | null;
  integrity: string;
}

/** The persona and memory files a home keeps at its root. */
const PERSONA_FILES = ['AGENTS.md', 'CLAUDE.md', 'MEMORY.md', 'USER.md', 'SOUL.md', 'DECK.md', 'triage-context.md'];

interface Opened {
  db: Database.Database;
  tables: Set<string>;
  columns: (table: string) => Set<string>;
}

function open(db: Database.Database): Opened {
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Row[]).map((r) => String(r.name)),
  );
  const cache = new Map<string, Set<string>>();
  return {
    db,
    tables,
    columns: (table) => {
      if (!cache.has(table)) {
        cache.set(table, new Set(tables.has(table) ? (db.prepare(`PRAGMA table_info("${table}")`).all() as Row[]).map((c) => String(c.name)) : []));
      }
      return cache.get(table)!;
    },
  };
}

function side(root: string, o: Opened): HomeSide {
  const home = o.tables.has('home') ? (o.db.prepare('SELECT id, name FROM home LIMIT 1').get() as Row | undefined) : undefined;
  const migrations = o.tables.has('__drizzle_migrations')
    ? (o.db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all() as Row[])
    : [];
  return {
    root,
    homeId: home ? text(home.id) : null,
    homeName: home ? text(home.name) : null,
    migrations: migrations.length,
    latestMigration: migrations.length ? text(migrations[migrations.length - 1]!.hash).slice(0, 12) : null,
    integrity: text((o.db.prepare('PRAGMA quick_check').get() as Row | undefined)?.quick_check ?? 'unknown'),
  };
}

function readKind(o: Opened, spec: KindSpec, shared: Set<string>): Map<string, Row> | null {
  if (!o.tables.has(spec.table)) return null;
  const cols = ['id', 'updated_at', 'status', ...spec.columns].filter((c) => shared.has(c));
  const rows = o.db.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${spec.table}"`).all() as Row[];
  return new Map(rows.map((r) => [text(r.id), r]));
}

function ref(spec: KindSpec, row: Row): RecordRef {
  return {
    id: text(row.id),
    title: spec.title(row),
    status: row.status == null ? null : text(row.status),
    updatedAt: row.updated_at == null ? null : text(row.updated_at),
  };
}

function compareKind(a: Opened, b: Opened, spec: KindSpec): KindComparison {
  // Only the columns both homes have, so different schemas still compare.
  const shared = new Set([...a.columns(spec.table)].filter((c) => b.columns(spec.table).has(c)));
  const onlyOneSide = !a.tables.has(spec.table) || !b.tables.has(spec.table);
  const rowsA = readKind(a, spec, onlyOneSide ? a.columns(spec.table) : shared);
  const rowsB = readKind(b, spec, onlyOneSide ? b.columns(spec.table) : shared);
  const result: KindComparison = {
    kind: spec.kind,
    counts: { a: rowsA?.size ?? null, b: rowsB?.size ?? null },
    inBoth: { unchanged: 0, newerInA: [], newerInB: [] },
    onlyInA: [],
    onlyInB: [],
    onlyInBLikeA: [],
    onlyInALikeB: [],
  };
  const A = rowsA ?? new Map<string, Row>();
  const B = rowsB ?? new Map<string, Row>();
  for (const [id, ra] of A) {
    const rb = B.get(id);
    if (!rb) {
      result.onlyInA.push(ref(spec, ra));
      continue;
    }
    const ua = text(ra.updated_at);
    const ub = text(rb.updated_at);
    if (ua === ub) result.inBoth.unchanged++;
    else if (ua > ub) result.inBoth.newerInA.push(ref(spec, ra));
    else result.inBoth.newerInB.push(ref(spec, rb));
  }
  for (const [id, rb] of B) if (!A.has(id)) result.onlyInB.push(ref(spec, rb));

  if (spec.likeness) {
    const likeness = spec.likeness;
    const index = (rows: Map<string, Row>, only: RecordRef[]) => {
      const onlyIds = new Set(only.map((r) => r.id));
      const byKey = new Map<string, Row>();
      for (const [id, row] of rows) {
        if (!onlyIds.has(id)) continue;
        const key = likeness(row);
        if (key && !byKey.has(key)) byKey.set(key, row);
      }
      return byKey;
    };
    const likeInA = index(A, result.onlyInA);
    const likeInB = index(B, result.onlyInB);
    for (const r of result.onlyInB) {
      const key = likeness(B.get(r.id)!);
      const match = key ? likeInA.get(key) : undefined;
      if (match) result.onlyInBLikeA.push({ b: r, a: ref(spec, match) });
    }
    for (const r of result.onlyInA) {
      const key = likeness(A.get(r.id)!);
      const match = key ? likeInB.get(key) : undefined;
      if (match) result.onlyInALikeB.push({ a: r, b: ref(spec, match) });
    }
  }
  return result;
}

function chatHistory(a: Opened, b: Opened): HomeComparison['chatHistory'] {
  const empty = { chatsInBoth: 0, moreInA: [], moreInB: [] };
  if (!a.tables.has('chat_events') || !b.tables.has('chat_events') || !a.tables.has('chat_sessions') || !b.tables.has('chat_sessions')) return empty;
  const counts = (o: Opened) =>
    new Map(
      (o.db.prepare('SELECT session_id AS id, count(*) AS n FROM chat_events GROUP BY session_id').all() as Row[]).map((r) => [text(r.id), Number(r.n)]),
    );
  const labels = (o: Opened) =>
    new Map((o.db.prepare('SELECT id, label, type FROM chat_sessions').all() as Row[]).map((r) => [text(r.id), text(r.label) || `(${text(r.type)})`]));
  const ca = counts(a);
  const cb = counts(b);
  const la = labels(a);
  const lb = labels(b);
  const out: HomeComparison['chatHistory'] = { chatsInBoth: 0, moreInA: [], moreInB: [] };
  for (const [id, title] of la) {
    if (!lb.has(id)) continue;
    out.chatsInBoth++;
    const na = ca.get(id) ?? 0;
    const nb = cb.get(id) ?? 0;
    if (na > nb) out.moreInA.push({ id, title, a: na, b: nb });
    else if (nb > na) out.moreInB.push({ id, title, a: na, b: nb });
  }
  return out;
}

function fileDigest(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Files named alike in two folders: only in one, or different, by size then content. */
export function compareFiles(dirA: string, dirB: string, names?: string[]): FileComparison {
  const list = (dir: string) =>
    names ? names.filter((n) => fs.existsSync(path.join(dir, n))) : fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => !n.startsWith('.')) : [];
  const inA = new Set(list(dirA));
  const inB = new Set(list(dirB));
  const out: FileComparison = { onlyInA: [], onlyInB: [], differ: [], same: 0 };
  for (const n of [...inA].sort()) {
    if (!inB.has(n)) {
      out.onlyInA.push(n);
      continue;
    }
    const fa = path.join(dirA, n);
    const fb = path.join(dirB, n);
    const sa = fs.statSync(fa);
    const sb = fs.statSync(fb);
    if (sa.isDirectory() || sb.isDirectory()) {
      if (sa.isDirectory() && sb.isDirectory()) {
        const inner = compareFiles(fa, fb);
        if (inner.onlyInA.length || inner.onlyInB.length || inner.differ.length) out.differ.push(n);
        else out.same++;
      } else out.differ.push(n);
      continue;
    }
    if (sa.size !== sb.size || fileDigest(fa) !== fileDigest(fb)) out.differ.push(n);
    else out.same++;
  }
  for (const n of [...inB].sort()) if (!inA.has(n)) out.onlyInB.push(n);
  return out;
}

/** Compare two homes, each a root or a backup of one. Neither is written to. */
export function compareHomes(rootA: string, rootB: string): HomeComparison {
  const dbA = path.join(rootA, 'data.db');
  const dbB = path.join(rootB, 'data.db');
  return withSourceDatabase(dbA, (rawA) =>
    withSourceDatabase(dbB, (rawB) => {
      const a = open(rawA);
      const b = open(rawB);
      const kinds = KINDS.map((spec) => compareKind(a, b, spec));
      const idsInA = kinds.reduce((n, k) => n + (k.counts.a ?? 0), 0);
      const sharedIds = kinds.reduce((n, k) => n + k.inBoth.unchanged + k.inBoth.newerInA.length + k.inBoth.newerInB.length, 0);
      return {
        a: side(rootA, a),
        b: side(rootB, b),
        sharedIdShare: idsInA ? sharedIds / idsInA : 0,
        kinds,
        chatHistory: chatHistory(a, b),
        attachments: compareFiles(path.join(rootA, 'attachments'), path.join(rootB, 'attachments')),
        persona: compareFiles(rootA, rootB, PERSONA_FILES),
        skills: compareFiles(path.join(rootA, 'skills'), path.join(rootB, 'skills')),
        skillDrafts: compareFiles(path.join(rootA, 'skill-drafts'), path.join(rootB, 'skill-drafts')),
      };
    }),
  );
}

/** The comparison as a person reads it: counts first, then what's only in B, which is what an import would bring. */
export function describeComparison(c: HomeComparison, opts: { names?: { a: string; b: string }; list?: number } = {}): string {
  const A = opts.names?.a ?? 'A';
  const B = opts.names?.b ?? 'B';
  const limit = opts.list ?? 15;
  const lines: string[] = [];
  const homeLine = (name: string, s: HomeSide) =>
    `${name}: ${s.root}${s.homeName ? `, home "${s.homeName}" (${s.homeId})` : ', no home record'}, ${s.migrations} migrations (latest ${s.latestMigration ?? 'none'}), integrity ${s.integrity}`;
  lines.push(homeLine(A, c.a), homeLine(B, c.b));
  lines.push(
    `Shared ids: ${(c.sharedIdShare * 100).toFixed(1)}% of ${A}'s records are also in ${B}` +
      (c.sharedIdShare > 0.5 ? ` (one began as a copy of the other)` : c.sharedIdShare === 0 ? ` (started apart)` : ''),
    '',
  );
  const header = ['', A, B, 'both', `newer ${A}`, `newer ${B}`, `only ${A}`, `only ${B}`, `${B} alike`];
  const rows = c.kinds.map((k) => [
    k.kind,
    String(k.counts.a ?? '-'),
    String(k.counts.b ?? '-'),
    String(k.inBoth.unchanged + k.inBoth.newerInA.length + k.inBoth.newerInB.length),
    String(k.inBoth.newerInA.length),
    String(k.inBoth.newerInB.length),
    String(k.onlyInA.length),
    String(k.onlyInB.length),
    String(k.onlyInBLikeA.length),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)) + 2);
  const line = (cells: string[]) => cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]!))).join('');
  lines.push(line(header), ...rows.map(line));
  lines.push('');
  lines.push(
    `Chats in both: ${c.chatHistory.chatsInBoth}, with more of the conversation in ${A}: ${c.chatHistory.moreInA.length}, in ${B}: ${c.chatHistory.moreInB.length}`,
  );
  const files = (label: string, f: FileComparison) =>
    `${label}: same ${f.same}, only in ${A} ${f.onlyInA.length}, only in ${B} ${f.onlyInB.length}, different ${f.differ.length}` +
    (f.differ.length && f.differ.length <= 10 ? ` (${f.differ.join(', ')})` : '');
  lines.push(
    files('Attachments', c.attachments),
    files('Persona and memory', c.persona),
    files('Skills', c.skills),
    files('Skill drafts', c.skillDrafts),
  );

  for (const k of c.kinds) {
    const brought = k.onlyInB.filter((r) => !k.onlyInBLikeA.some((l) => l.b.id === r.id));
    if (!brought.length && !k.inBoth.newerInB.length && !k.onlyInBLikeA.length) continue;
    lines.push('', `${k.kind} in ${B} that ${A} lacks:`);
    for (const r of brought.slice(0, limit)) lines.push(`  + ${r.title}${r.status ? ` [${r.status}]` : ''}  ${r.id}`);
    if (brought.length > limit) lines.push(`  … and ${brought.length - limit} more`);
    for (const l of k.onlyInBLikeA.slice(0, limit)) lines.push(`  ~ ${l.b.title}  ${l.b.id} looks like ${A}'s ${l.a.id}`);
    if (k.onlyInBLikeA.length > limit) lines.push(`  … and ${k.onlyInBLikeA.length - limit} more alike`);
    for (const r of k.inBoth.newerInB.slice(0, limit)) lines.push(`  ↑ ${r.title}  ${r.id} changed later in ${B}`);
    if (k.inBoth.newerInB.length > limit) lines.push(`  … and ${k.inBoth.newerInB.length - limit} more changed later in ${B}`);
  }
  return lines.join('\n');
}
