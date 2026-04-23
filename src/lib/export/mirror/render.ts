/**
 * Mirror-format rendering.
 *
 * Produces the frontmatter + body content written to disk by the live mirror.
 * Shape differs from the bulk `export` command:
 *   - Frontmatter carries `managed_by: flow` and denormalized display names
 *   - Header HTML comment warns readers the file is managed
 *   - Notes include a "Sources" section when other entities were promoted into them
 *   - Stream items are a first-class type (bulk export doesn't cover them)
 *
 * Wiki links: when a LinkResolver is passed, frontmatter emits Obsidian-style
 * `[[type/slug--uuid]]` targets for FK relations alongside the denormalized
 * name/title fields. Both coexist — the link is for navigation in a vault
 * viewer, the name is for plain-text readability and fallback when the target
 * hasn't been written yet.
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
  Attachment,
} from '@/db/types';
import { slugify } from '@/lib/export/markdown';
import type { EntityType } from './config';
import { rewriteAttachmentsForMirror } from '@/lib/attachments/derive';

const SLUG_MAX = 60;

const HEADER_COMMENTS = [
  `<!-- Managed by ${APP_SHORT_ID}. Edits here are overwritten on next sync. -->`,
  `<!-- To modify: use the app, an MCP tool, or write SQL directly. -->`,
].join('\n');

// ─── Filename + link helpers ─────────────────────────────────

export function mirrorFilename(nameOrTitle: string | null | undefined, id: string): string {
  const base = slugify(nameOrTitle ?? '').slice(0, SLUG_MAX);
  return base ? `${base}--${id}.md` : `${id}.md`;
}

/**
 * Wiki-link target (no `.md` extension) for a mirror entity, e.g.
 * `tasks/buy-milk--01975abc...`. Used by the LinkResolver to build
 * Obsidian-style `[[...]]` refs in frontmatter.
 */
export function mirrorLinkPath(type: EntityType, nameOrTitle: string | null | undefined, id: string): string {
  const filename = mirrorFilename(nameOrTitle, id);
  const stem = filename.slice(0, -3);
  return `${type}s/${stem}`;
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

// ─── Wiki link resolver ──────────────────────────────────────

/**
 * Resolves an entity reference to a wiki-link target (no `.md`). Returns null
 * when the target can't be found — caller falls back to the denormalized name
 * field. Mirror-local type (rather than the shared markdown one) because the
 * mirror has a fourth entity type: `stream`.
 */
export interface LinkResolver {
  linkFor(type: EntityType, id: string): string | null;
}

function wikiLink(
  resolver: LinkResolver | undefined,
  type: EntityType,
  id: string | null | undefined,
): string | null {
  if (!id || !resolver) return null;
  const target = resolver.linkFor(type, id);
  return target ? `[[${target}]]` : null;
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
  if (typeof v === 'object') {
    // Flow-style mapping: `{key: value, key: value}`. Keeps the writer
    // single-line-per-field without adopting block style for the whole doc.
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .map(([key, val]) => `${key}: ${yamlValue(val)}`);
    return '{' + entries.join(', ') + '}';
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

/** Strip `uploaded_at` for mirror frontmatter — noise that churns every
 *  edit and has no human value. Keep file_name/original_name/mime_type/size. */
function attachmentsForFrontmatter(
  attachments: Attachment[] | null | undefined,
): Array<Omit<Attachment, 'uploaded_at'>> | null {
  if (!attachments || attachments.length === 0) return null;
  return attachments.map(({ uploaded_at, ...rest }) => rest);
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
  links?: LinkResolver;
}

export function renderTask(task: TaskRecord, opts: RenderTaskOpts = {}): { filename: string; content: string } {
  const frontmatter = buildFrontmatter({
    id: task.id,
    type: 'task',
    title: task.title,
    status: task.status,
    area: wikiLink(opts.links, 'area', task.area_id),
    area_id: task.area_id,
    area_name: opts.areaName ?? null,
    parent: wikiLink(opts.links, 'task', task.parent_id),
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
    attachments: attachmentsForFrontmatter(task.attachments),
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

  const description = rewriteAttachmentsForMirror(task.description ?? '').trim();
  const body = rewriteAttachmentsForMirror(task.body ?? '').trim();
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
  links?: LinkResolver;
}

export function renderNote(note: NoteRecord, opts: RenderNoteOpts = {}): { filename: string; content: string } {
  const sources = opts.sources ?? [];
  const sourceIds = sources.map((s) => s.id);
  const sourceLinks = opts.links
    ? sources.map((s) => opts.links!.linkFor('stream', s.id)).filter((x): x is string => x !== null).map((p) => `[[${p}]]`)
    : [];

  const frontmatter = buildFrontmatter({
    id: note.id,
    type: 'note',
    title: note.title,
    status: note.status,
    area: wikiLink(opts.links, 'area', note.area_id),
    area_id: note.area_id,
    area_name: opts.areaName ?? null,
    task: wikiLink(opts.links, 'task', note.task_id),
    task_id: note.task_id,
    task_title: opts.taskTitle ?? null,
    url: note.url,
    context_tags: note.context_tags,
    attachments: attachmentsForFrontmatter(note.attachments),
    sources: sourceLinks.length > 0 ? sourceLinks : null,
    source_ids: sourceIds.length > 0 ? sourceIds : null,
    created_at: note.created_at,
    updated_at: note.updated_at,
    managed_by: APP_SHORT_ID,
  });

  const parts: string[] = [frontmatter, '', HEADER_COMMENTS];
  if (note.title) parts.push('', `# ${note.title}`);
  const body = rewriteAttachmentsForMirror(note.body ?? '').trim();
  if (body) parts.push('', body);

  if (sources.length > 0) {
    parts.push('', '## Sources', '');
    for (const s of sources) {
      const heading = streamSourceHeading(s, opts.links);
      parts.push(`### ${heading}`);
      const rawText = rewriteAttachmentsForMirror(s.raw_text ?? '');
      const quoted = rawText.split('\n').map((line) => `> ${line}`).join('\n');
      parts.push('', quoted, '');
    }
  }

  return {
    filename: mirrorFilename(note.title, note.id),
    content: parts.join('\n').replace(/\n+$/, '') + '\n',
  };
}

function streamSourceHeading(s: StreamRecord, links?: LinkResolver): string {
  const date = (s.created_at ?? '').slice(0, 19).replace('T', ' ');
  const source = s.source ?? 'capture';
  const label = `${source} — ${date}`.trim();
  const target = links?.linkFor('stream', s.id);
  // Obsidian-style aliased link so the rendered heading shows the human label.
  return target ? `[[${target}|${label}]]` : label;
}

// ─── Area → Markdown ─────────────────────────────────────────

export interface RenderAreaOpts {
  /** Present for API symmetry. Areas have no outbound FK references today. */
  links?: LinkResolver;
}

export function renderArea(area: AreaRecord, _opts: RenderAreaOpts = {}): { filename: string; content: string } {
  const frontmatter = buildFrontmatter({
    id: area.id,
    type: 'area',
    name: area.name,
    status: area.status,
    emoji: area.emoji,
    sort_order: area.sort_order,
    description: area.description,
    attachments: attachmentsForFrontmatter(area.attachments),
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
  links?: LinkResolver;
}

export function renderStream(s: StreamRecord, opts: RenderStreamOpts = {}): { filename: string; content: string } {
  const promotedLink =
    s.promoted_to_type && s.promoted_to_id
      ? wikiLink(opts.links, s.promoted_to_type as EntityType, s.promoted_to_id)
      : null;

  const frontmatter = buildFrontmatter({
    id: s.id,
    type: 'stream',
    source: s.source,
    status: s.status,
    promoted_to: promotedLink,
    promoted_to_type: s.promoted_to_type,
    promoted_to_id: s.promoted_to_id,
    promoted_to_title: opts.promotedToTitle ?? null,
    promoted_at: s.promoted_at,
    dismissed_by: s.dismissed_by,
    attachments: attachmentsForFrontmatter(s.attachments),
    created_at: s.created_at,
    managed_by: APP_SHORT_ID,
  });

  const parts: string[] = [frontmatter, '', HEADER_COMMENTS, '', rewriteAttachmentsForMirror(s.raw_text ?? '').trim()];

  // Short slug from the first few words of raw_text, to keep filenames scannable.
  const firstLine = (s.raw_text ?? '').split('\n')[0]?.trim() ?? '';
  const slug = firstLine.length > 0 ? firstLine.slice(0, 40) : '';

  return {
    filename: mirrorFilename(slug, s.id),
    content: parts.join('\n').replace(/\n+$/, '') + '\n',
  };
}
