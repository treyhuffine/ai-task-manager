/**
 * Mirror-format rendering.
 *
 * Produces the frontmatter + body content written to disk by the live mirror.
 * Shape differs from the bulk `export` command:
 *   - Frontmatter carries `managedBy: flow` and denormalized display names
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

/** Strip `uploadedAt` for mirror frontmatter — noise that churns every
 *  edit and has no human value. Keep fileName/originalName/mimeType/size. */
function attachmentsForFrontmatter(
  attachments: Attachment[] | null | undefined,
): Array<Omit<Attachment, 'uploadedAt'>> | null {
  if (!attachments || attachments.length === 0) return null;
  return attachments.map(({ uploadedAt, ...rest }) => rest);
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
    area: wikiLink(opts.links, 'area', task.areaId),
    areaId: task.areaId,
    areaName: opts.areaName ?? null,
    parent: wikiLink(opts.links, 'task', task.parentId),
    parentId: task.parentId,
    parentTitle: opts.parentTitle ?? null,
    energy: task.energy,
    effort: task.effort,
    estimatedMinutes: task.estimatedMinutes,
    heartbeatDays: task.heartbeatDays,
    hardDeadline: task.hardDeadline,
    resurfaceAfter: task.resurfaceAfter,
    reminderAt: task.reminderAt,
    recurrence: task.recurrence,
    nextRecurrenceAt: task.nextRecurrenceAt,
    targetFrequency: task.targetFrequency,
    contextTags: task.contextTags,
    attachments: attachmentsForFrontmatter(task.attachments),
    blockedOn: task.blockedOn,
    blockedSince: task.blockedSince,
    outcome: task.outcome,
    timesDeferred: task.timesDeferred || null,
    lastProgressAt: task.lastProgressAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    managedBy: APP_SHORT_ID,
  });

  const description = rewriteAttachmentsForMirror(task.description ?? '').trim();
  const body = rewriteAttachmentsForMirror(task.body ?? '').trim();
  const userContext = (task.userContext ?? '').trim();

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
    area: wikiLink(opts.links, 'area', note.areaId),
    areaId: note.areaId,
    areaName: opts.areaName ?? null,
    task: wikiLink(opts.links, 'task', note.taskId),
    taskId: note.taskId,
    taskTitle: opts.taskTitle ?? null,
    url: note.url,
    contextTags: note.contextTags,
    attachments: attachmentsForFrontmatter(note.attachments),
    sources: sourceLinks.length > 0 ? sourceLinks : null,
    sourceIds: sourceIds.length > 0 ? sourceIds : null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    managedBy: APP_SHORT_ID,
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
      const rawText = rewriteAttachmentsForMirror(s.rawText ?? '');
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
  const date = (s.createdAt ?? '').slice(0, 19).replace('T', ' ');
  const source = s.source ?? 'capture';
  const label = `${source}: ${date}`.trim();
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
    sortOrder: area.sortOrder,
    description: area.description,
    attachments: attachmentsForFrontmatter(area.attachments),
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
    managedBy: APP_SHORT_ID,
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
  if (area.userContext) parts.push('', '## Context', '', area.userContext);

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
    s.promotedToType && s.promotedToId
      ? wikiLink(opts.links, s.promotedToType as EntityType, s.promotedToId)
      : null;

  const frontmatter = buildFrontmatter({
    id: s.id,
    type: 'stream',
    source: s.source,
    status: s.status,
    promotedTo: promotedLink,
    promotedToType: s.promotedToType,
    promotedToId: s.promotedToId,
    promotedToTitle: opts.promotedToTitle ?? null,
    promotedAt: s.promotedAt,
    dismissedBy: s.dismissedBy,
    attachments: attachmentsForFrontmatter(s.attachments),
    createdAt: s.createdAt,
    managedBy: APP_SHORT_ID,
  });

  const parts: string[] = [frontmatter, '', HEADER_COMMENTS, '', rewriteAttachmentsForMirror(s.rawText ?? '').trim()];

  // Short slug from the first few words of rawText, to keep filenames scannable.
  const firstLine = (s.rawText ?? '').split('\n')[0]?.trim() ?? '';
  const slug = firstLine.length > 0 ? firstLine.slice(0, 40) : '';

  return {
    filename: mirrorFilename(slug, s.id),
    content: parts.join('\n').replace(/\n+$/, '') + '\n',
  };
}
