/**
 * `<app> export [options]`
 *
 * One-way export of tasks, notes, and areas from the local database to
 * markdown files with YAML frontmatter. Intended for backups and external
 * tools (Obsidian, Logseq, static site generators). For a lossless backup,
 * copy the SQLite DB file directly.
 *
 *   <app> export                                 → everything to ./flow-export-<ts>/
 *   <app> export --out ./backup                  → everything to ./backup/
 *   <app> export --tasks                         → tasks only
 *   <app> export --notes                         → notes only
 *   <app> export --areas                         → areas only
 *   <app> export --include-archived              → include archived items
 *   <app> export --task <id>                     → single task to stdout
 *   <app> export --note <id>                     → single note to stdout
 *   <app> export --area <id>                     → single area to stdout
 *   <app> export --task <id> --out task.md       → single to file
 *
 * Bulk exports include Obsidian-style [[wiki/links]] in frontmatter for
 * foreign-key relations (area, parent task, linked task).
 */

import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { Command } from 'commander';
import { listTasks, getTask, listNotes, getNote, listAreas, getArea } from '@/lib/db/queries';
import { getUserDataDir } from '@/lib/config/paths';
import {
  taskToMarkdown,
  noteToMarkdown,
  areaToMarkdown,
  slugify,
  type LinkResolver,
  type EntityType,
} from '@/lib/export/markdown';
import type { TaskRecord, NoteRecord, AreaRecord, NoteStatus } from '@/db/types';

// Safety ceiling. If a real vault ever hits this, we warn rather than
// silently truncate (see countWarning below).
const MAX_EXPORT_ITEMS = 100_000;

interface ExportOptions {
  out?: string;
  task?: string;
  note?: string;
  area?: string;
  tasks?: boolean;
  notes?: boolean;
  areas?: boolean;
  includeArchived?: boolean;
}

export function registerExportCommand(program: Command) {
  program
    .command('export')
    .description('Export tasks, notes, and areas as markdown (one-way)')
    .option('-o, --out <path>', 'output directory (or file when exporting a single item)')
    .option('--task <id>', 'export a single task')
    .option('--note <id>', 'export a single note')
    .option('--area <id>', 'export a single area')
    .option('--tasks', 'bulk: tasks only')
    .option('--notes', 'bulk: notes only')
    .option('--areas', 'bulk: areas only')
    .option('--include-archived', 'include archived items in bulk export')
    .action(exportCommand);
}

async function exportCommand(opts: ExportOptions) {
  // Single-item modes: write to stdout (or --out if provided). No link
  // resolver because we don't have the rest of the vault loaded.
  if (opts.task) {
    const task = getTask(opts.task);
    if (!task) return fail(`Task not found: ${opts.task}`);
    const areasById = buildAreaMap();
    const { filename, content } = taskToMarkdown(task, {
      areaName: areaNameFor(task.area_id, areasById),
    });
    writeSingle(content, filename, opts.out);
    return;
  }

  if (opts.note) {
    const note = getNote(opts.note);
    if (!note) return fail(`Note not found: ${opts.note}`);
    const areasById = buildAreaMap();
    const { filename, content } = noteToMarkdown(note, {
      areaName: areaNameFor(note.area_id, areasById),
    });
    writeSingle(content, filename, opts.out);
    return;
  }

  if (opts.area) {
    const area = getArea(opts.area);
    if (!area) return fail(`Area not found: ${opts.area}`);
    const { filename, content } = areaToMarkdown(area);
    writeSingle(content, filename, opts.out);
    return;
  }

  // ── Bulk mode ────────────────────────────────────────────────
  const noFlags = !opts.tasks && !opts.notes && !opts.areas;
  const wantTasks = opts.tasks || noFlags;
  const wantNotes = opts.notes || noFlags;
  const wantAreas = opts.areas || noFlags;

  const outDir = path.resolve(opts.out ?? defaultOutDir());
  fs.mkdirSync(outDir, { recursive: true });

  // Load all records up front so we can build a cross-reference registry
  // for [[wiki/links]] in frontmatter.
  const noteStatuses: NoteStatus[] = opts.includeArchived ? ['active', 'archived'] : ['active'];
  const taskStatuses = opts.includeArchived
    ? (['active', 'done', 'archived'] as const)
    : (['active', 'done'] as const);

  const allAreas = wantAreas ? listAreas({ status: 'all' }) : [];
  const allTasks = wantTasks ? listTasks({ status: [...taskStatuses], limit: MAX_EXPORT_ITEMS }) : [];
  const allNotes = wantNotes
    ? noteStatuses.flatMap((status) => listNotes({ status, limit: MAX_EXPORT_ITEMS }))
    : [];

  const registry = buildLinkRegistry({ tasks: allTasks, notes: allNotes, areas: allAreas });
  const resolver: LinkResolver = {
    linkFor: (type, id) => registry.get(registryKey(type, id)) ?? null,
  };

  let taskCount = 0;
  let noteCount = 0;
  let areaCount = 0;

  if (wantAreas) {
    const dir = path.join(outDir, 'areas');
    fs.mkdirSync(dir, { recursive: true });
    const used = new Set<string>();
    for (const a of allAreas) {
      const { filename, content } = areaToMarkdown(a);
      const finalName = uniqueName(filename, a.id, used);
      fs.writeFileSync(path.join(dir, finalName), content, 'utf8');
      areaCount++;
    }
  }

  if (wantTasks) {
    const dir = path.join(outDir, 'tasks');
    fs.mkdirSync(dir, { recursive: true });
    // Pre-computed registry already has filenames; write them in the same
    // order to match.
    const areasById = new Map(allAreas.map((a) => [a.id, a] as const));
    for (const t of allTasks) {
      const { content } = taskToMarkdown(t, {
        areaName: areaNameFor(t.area_id, areasById),
        links: resolver,
      });
      const filename = mustGet(registry, registryKey('task', t.id)).split('/').pop()! + '.md';
      fs.writeFileSync(path.join(dir, filename), content, 'utf8');
      taskCount++;
    }
  }

  if (wantNotes) {
    const dir = path.join(outDir, 'notes');
    fs.mkdirSync(dir, { recursive: true });
    const areasById = new Map(allAreas.map((a) => [a.id, a] as const));
    for (const n of allNotes) {
      const { content } = noteToMarkdown(n, {
        areaName: areaNameFor(n.area_id, areasById),
        links: resolver,
      });
      const filename = mustGet(registry, registryKey('note', n.id)).split('/').pop()! + '.md';
      fs.writeFileSync(path.join(dir, filename), content, 'utf8');
      noteCount++;
    }
  }

  console.log(pc.green('Export complete.'));
  console.log(pc.dim(`  ${outDir}`));
  if (wantAreas) console.log(`  ${areaCount} area${areaCount === 1 ? '' : 's'}`);
  if (wantTasks) console.log(`  ${taskCount} task${taskCount === 1 ? '' : 's'}`);
  if (wantNotes) console.log(`  ${noteCount} note${noteCount === 1 ? '' : 's'}`);
  countWarning('tasks', taskCount);
  countWarning('notes', noteCount);
}

// ─── Link registry ────────────────────────────────────────────
// Computes unique, path-qualified filenames for every exported record so
// cross-references (area_id, parent_id, task_id) can be emitted as
// Obsidian-style wiki links in frontmatter.

function registryKey(type: EntityType, id: string): string {
  return `${type}:${id}`;
}

function buildLinkRegistry(data: {
  tasks: TaskRecord[];
  notes: NoteRecord[];
  areas: AreaRecord[];
}): Map<string, string> {
  const reg = new Map<string, string>();
  assignFilenames('area', data.areas, (a) => a.name || a.id, reg);
  assignFilenames('task', data.tasks, (t) => t.title, reg);
  assignFilenames('note', data.notes, (n) => n.title ?? '', reg);
  return reg;
}

function assignFilenames<T extends { id: string }>(
  type: EntityType,
  records: T[],
  nameOf: (r: T) => string,
  reg: Map<string, string>,
): void {
  const dir = `${type}s`;
  const used = new Set<string>();
  for (const r of records) {
    const base = slugify(nameOf(r)) || r.id;
    let candidate = base;
    if (used.has(candidate)) candidate = `${base}-${r.id.slice(-6)}`;
    used.add(candidate);
    reg.set(registryKey(type, r.id), `${dir}/${candidate}`);
  }
}

// ─── Area lookup (for single-item / frontmatter name fallback) ────

function buildAreaMap(): Map<string, AreaRecord> {
  const map = new Map<string, AreaRecord>();
  for (const a of listAreas({ status: 'all' })) map.set(a.id, a);
  return map;
}

function areaNameFor(id: string | null, map: Map<string, AreaRecord>): string | null {
  if (!id) return null;
  return map.get(id)?.name ?? null;
}

// ─── File I/O helpers ─────────────────────────────────────────

function defaultOutDir(): string {
  const ts = new Date().toISOString().slice(0, 10);
  return path.join(getUserDataDir(), 'exports', `flow-export-${ts}`);
}

function writeSingle(content: string, defaultName: string, out?: string) {
  if (!out) {
    process.stdout.write(content);
    return;
  }
  const resolved = path.resolve(out);
  let target = resolved;
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    target = path.join(resolved, defaultName);
  } else {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  fs.writeFileSync(target, content, 'utf8');
  console.log(pc.green('Wrote'), pc.dim(target));
}

function uniqueName(preferred: string, id: string, used: Set<string>): string {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  const ext = path.extname(preferred);
  const base = preferred.slice(0, -ext.length);
  const suffixed = `${base}-${id.slice(-6)}${ext}`;
  used.add(suffixed);
  return suffixed;
}

// ─── Misc ─────────────────────────────────────────────────────

function mustGet<K, V>(m: Map<K, V>, k: K): V {
  const v = m.get(k);
  if (v === undefined) throw new Error(`registry missing entry: ${String(k)}`);
  return v;
}

function countWarning(label: string, count: number) {
  if (count >= MAX_EXPORT_ITEMS) {
    console.warn(
      pc.yellow(`! ${label} export hit the ${MAX_EXPORT_ITEMS} cap — results may be truncated.`),
    );
  }
}

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}
