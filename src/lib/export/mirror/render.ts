/**
 * Mirror-format rendering.
 *
 * Produces the frontmatter + body content written to disk by the live mirror.
 * Shape differs from the bulk `export` command:
 *   - Frontmatter carries `managed_by: flow` and denormalized display names
 *   - Header HTML comment warns readers the file is managed
 *   - No wiki-links (the mirror is a flat snapshot, not an Obsidian vault)
 *   - Notes include a "Sources" section when other entities were promoted into them
 *   - Stream items are a first-class type (bulk export doesn't cover them)
 *
 * Filename format: `{slug}--{uuid}.md` with a double-separator so IDs with
 * internal hyphens (UUIDv7) parse back out unambiguously.
 */

import { APP_SHORT_ID } from '@/constants/app';
import type {
  TaskRecord,
  NoteRecord,
  AreaRecord,
  StreamRecord,
} from '@/db/types';
import { slugify } from '@/lib/export/markdown';

const SLUG_MAX = 60;

const HEADER_COMMENTS = [
  `<!-- Managed by ${APP_SHORT_ID}. Edits here are overwritten on next sync. -->`,
  `<!-- To modify: use the app, an MCP tool, or write SQL directly. -->`,
].join('\n');

// ─── Filename helpers ────────────────────────────────────────

export function mirrorFilename(nameOrTitle: string | null | undefined, id: string): string {
  const base = slugify(nameOrTitle ?? '').slice(0, SLUG_MAX);
  return base ? `${base}--${id}.md` : `${id}.md`;
}

/** Parse a mirror filename and extract the entity ID. Returns null if unparseable. */
export function parseMirrorFilename(filename: string): { slug: string | null; id: string } | null {
  if (!filename.endsWith('.md')) return null;
  const stem = filename.slice(0, -3);
  const lastSep = stem.lastIndexOf('--');
  if (lastSep === -1) {
    // Bare `<id>.md` — no slug. Treat whole stem as ID.
    return { slug: null, id: stem };
  }
  return { slug: stem.slice(0, lastSep), id: stem.slice(lastSep + 2) };
}

// ─── YAML frontmatter ────────────────────────────────────────
// Minimal, conservative YAML writer. Handles strings, numbers, booleans, null,
// arrays of primitives. For richer structures (nested objects, multi-line
// blocks) we render them into the body instead of the frontmatter.

function yamlValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '[' + v.map((x) => yamlValue(x)).join(', ') + ']';
  }
  const s = String(v);
  if (
    /[\r\n]/.test(s) ||
    /^\s|\s$|[:#\-&*!?|>'"%@`,\[\]{}]|^(true|false|null|yes|no|\d)/i.test(s) ||
    s === ''
  ) {
    return (
      '"' +
      s
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r') +
      '"'
    );
  }
  return s;
}

function buildFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    lines.push(`${key}: ${yamlValue(value)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// ─── Task → Markdown ─────────────────────────────────────────

export interface RenderTaskOpts {
  areaName?: string | null;
  parentTitle?: string | null;
}

export function renderTask(task: TaskRecord, opts: RenderTaskOpts = {}): { filename: string; content: string } {
  const frontmatter = buildFrontmatter({
    id: task.id,
    type: 'task',
    title: task.title,
    status: task.status,
    area_id: task.area_id,
    area_name: opts.areaName ?? null,
    parent_id: task.parent_id,
    parent_title: opts.parentTitle ?? null,
    energy: task.energy,
    effort: task.effort,
    estimated_minutes: task.estimated_minutes,
    heartbeat_days: task.heartbeat_days,
    hard_deadline: task.hard_deadline,
    resurface_after: task.resurface_after,
    reminder_at: task.reminder_at,
    recurrence: task.recurrence,
    next_recurrence_at: task.next_recurrence_at,
    target_frequency: task.target_frequency,
    context_tags: task.context_tags,
    attachments: task.attachments,
    blocked_on: task.blocked_on,
    blocked_since: task.blocked_since,
    outcome: task.outcome,
    times_deferred: task.times_deferred || null,
    last_progress_at: task.last_progress_at,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
    managed_by: APP_SHORT_ID,
  });

  const description = (task.description ?? '').trim();
  const body = (task.body ?? '').trim();
  const userContext = (task.user_context ?? '').trim();

  const parts: string[] = [frontmatter, '', HEADER_COMMENTS, '', `# ${task.title}`];
  if (description) parts.push('', description);
  if (body) parts.push('', body);
  if (userContext) parts.push('', '## Context', '', userContext);

  return {
    filename: mirrorFilename(task.title, task.id),
    content: parts.join('\n') + '\n',
  };
}

// ─── Note → Markdown ─────────────────────────────────────────

export interface RenderNoteOpts {
  areaName?: string | null;
  taskTitle?: string | null;
  /** Stream items promoted into this note. Rendered as a Sources section. */
  sources?: StreamRecord[];
}

export function renderNote(note: NoteRecord, opts: RenderNoteOpts = {}): { filename: string; content: string } {
  const sourceIds = (opts.sources ?? []).map((s) => s.id);

  const frontmatter = buildFrontmatter({
    id: note.id,
    type: 'note',
    title: note.title,
    status: note.status,
    area_id: note.area_id,
    area_name: opts.areaName ?? null,
    task_id: note.task_id,
    task_title: opts.taskTitle ?? null,
    url: note.url,
    context_tags: note.context_tags,
    source_ids: sourceIds.length > 0 ? sourceIds : null,
    created_at: note.created_at,
    updated_at: note.updated_at,
    managed_by: APP_SHORT_ID,
  });

  const parts: string[] = [frontmatter, '', HEADER_COMMENTS];
  if (note.title) parts.push('', `# ${note.title}`);
  const body = (note.body ?? '').trim();
  if (body) parts.push('', body);

  if (opts.sources && opts.sources.length > 0) {
    parts.push('', '## Sources', '');
    for (const s of opts.sources) {
      const heading = streamSourceHeading(s);
      parts.push(`### ${heading}`);
      const quoted = (s.raw_text ?? '').split('\n').map((line) => `> ${line}`).join('\n');
      parts.push('', quoted, '');
    }
  }

  return {
    filename: mirrorFilename(note.title, note.id),
    content: parts.join('\n').replace(/\n+$/, '') + '\n',
  };
}

function streamSourceHeading(s: StreamRecord): string {
  const date = (s.created_at ?? '').slice(0, 19).replace('T', ' ');
  const source = s.source ?? 'capture';
  return `${source} — ${date}`.trim();
}

// ─── Area → Markdown ─────────────────────────────────────────

export function renderArea(area: AreaRecord): { filename: string; content: string } {
  const frontmatter = buildFrontmatter({
    id: area.id,
    type: 'area',
    name: area.name,
    status: area.status,
    emoji: area.emoji,
    sort_order: area.sort_order,
    description: area.description,
    created_at: area.created_at,
    updated_at: area.updated_at,
    managed_by: APP_SHORT_ID,
  });

  const parts: string[] = [
    frontmatter,
    '',
    HEADER_COMMENTS,
    '',
    `# ${area.emoji ? area.emoji + ' ' : ''}${area.name}`,
  ];
  if (area.description) parts.push('', area.description);
  if (area.notes) parts.push('', '## Notes', '', area.notes);
  if (area.user_context) parts.push('', '## Context', '', area.user_context);

  return {
    filename: mirrorFilename(area.name, area.id),
    content: parts.join('\n') + '\n',
  };
}

// ─── Stream → Markdown ───────────────────────────────────────

export interface RenderStreamOpts {
  /** Title of the entity this stream was promoted into (if any), for readability. */
  promotedToTitle?: string | null;
}

export function renderStream(s: StreamRecord, opts: RenderStreamOpts = {}): { filename: string; content: string } {
  const frontmatter = buildFrontmatter({
    id: s.id,
    type: 'stream',
    source: s.source,
    status: s.status,
    promoted_to_type: s.promoted_to_type,
    promoted_to_id: s.promoted_to_id,
    promoted_to_title: opts.promotedToTitle ?? null,
    promoted_at: s.promoted_at,
    dismissed_by: s.dismissed_by,
    audio_file: s.audio_file,
    created_at: s.created_at,
    managed_by: APP_SHORT_ID,
  });

  const parts: string[] = [frontmatter, '', HEADER_COMMENTS, '', (s.raw_text ?? '').trim()];

  // Short slug from the first few words of raw_text, to keep filenames scannable.
  const firstLine = (s.raw_text ?? '').split('\n')[0]?.trim() ?? '';
  const slug = firstLine.length > 0 ? firstLine.slice(0, 40) : '';

  return {
    filename: mirrorFilename(slug, s.id),
    content: parts.join('\n').replace(/\n+$/, '') + '\n',
  };
}
