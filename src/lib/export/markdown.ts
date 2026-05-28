// Markdown export utilities for tasks, notes, and areas.
// Produces a YAML-frontmatter + body string for a record. Frontmatter may
// include Obsidian-style [[wiki/links]] for foreign-key relations when a
// LinkResolver is provided (bulk-export context).
//
// One-way format: intended for backups and external tools. There is no
// corresponding import — a pristine DB-file backup is better for fidelity.

import slugifyLib from '@sindresorhus/slugify'
import type { TaskRecord, NoteRecord, AreaRecord, Attachment } from '@/db/types'
import { rewriteAttachmentsForMirror } from '@/lib/attachments/derive'

// ─── Link resolution ──────────────────────────────────────────

export type EntityType = 'task' | 'note' | 'area'

export interface LinkResolver {
  /** Return the wiki-link target (path without `.md`) for a given entity, or null if unknown. */
  linkFor(type: EntityType, id: string): string | null
}

function wikiLink(resolver: LinkResolver | undefined, type: EntityType, id: string | null): string | null {
  if (!id || !resolver) return null
  const target = resolver.linkFor(type, id)
  return target ? `[[${target}]]` : null
}

// ─── Helpers ──────────────────────────────────────────────────

export function slugify(s: string): string {
  // Unicode-aware: transliterates non-ASCII (café → cafe, 会議 → hui-yi),
  // strips emoji, collapses whitespace/hyphens. Handles titles in any language.
  return slugifyLib(s, { lowercase: true, decamelize: false }).slice(0, 80)
}

// Minimal YAML value serializer — handles strings, numbers, booleans, null,
// arrays, and (flow-style) objects.
function yamlValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    return '[' + v.map((x) => yamlValue(x)).join(', ') + ']'
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .map(([key, val]) => `${key}: ${yamlValue(val)}`)
    return '{' + entries.join(', ') + '}'
  }
  const s = String(v)
  // Quote if it contains newlines, YAML-significant chars, leading/trailing
  // whitespace, or could be mis-parsed as a number/bool/null. Newlines must be
  // escaped inside the quoted form — a literal newline would break the
  // frontmatter parse for everything after it.
  if (/[\r\n]/.test(s) || /^\s|\s$|[:#\-&*!?|>'"%@`,\[\]{}]|^(true|false|null|yes|no|\d)/i.test(s) || s === '') {
    return (
      '"' +
      s
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r') +
      '"'
    )
  }
  return s
}

/** Strip `uploadedAt` from exported attachments — stable, human-meaningful
 *  fields only. */
function attachmentsForFrontmatter(
  attachments: Attachment[] | null | undefined,
): Array<Omit<Attachment, 'uploadedAt'>> | null {
  if (!attachments || attachments.length === 0) return null
  return attachments.map(({ uploadedAt, ...rest }) => rest)
}

function buildFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    lines.push(`${key}: ${yamlValue(value)}`)
  }
  lines.push('---')
  return lines.join('\n')
}

// ─── Task → Markdown ──────────────────────────────────────────

export function taskToMarkdown(
  task: TaskRecord,
  opts: { areaName?: string | null; links?: LinkResolver } = {},
): { filename: string; content: string } {
  const frontmatter = buildFrontmatter({
    id: task.id,
    type: 'task',
    title: task.title,
    status: task.status,
    area: wikiLink(opts.links, 'area', task.areaId) ?? opts.areaName ?? null,
    areaId: task.areaId,
    parent: wikiLink(opts.links, 'task', task.parentId),
    parentId: task.parentId,
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
  })

  const parts: string[] = [frontmatter, '', `# ${task.title}`]
  const description = rewriteAttachmentsForMirror(task.description ?? '').trim()
  const body = rewriteAttachmentsForMirror(task.body ?? '').trim()
  const userContext = (task.userContext ?? '').trim()
  if (description) parts.push('', description)
  if (body) parts.push('', body)
  if (userContext) parts.push('', '## Context', '', userContext)
  const content = parts.join('\n') + '\n'
  const filename = `${slugify(task.title) || task.id}.md`
  return { filename, content }
}

// ─── Note → Markdown ──────────────────────────────────────────

export function noteToMarkdown(
  note: NoteRecord,
  opts: { areaName?: string | null; links?: LinkResolver } = {},
): { filename: string; content: string } {
  const frontmatter = buildFrontmatter({
    id: note.id,
    type: 'note',
    title: note.title,
    status: note.status,
    area: wikiLink(opts.links, 'area', note.areaId) ?? opts.areaName ?? null,
    areaId: note.areaId,
    task: wikiLink(opts.links, 'task', note.taskId),
    taskId: note.taskId,
    url: note.url,
    contextTags: note.contextTags,
    attachments: attachmentsForFrontmatter(note.attachments),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  })

  const body = rewriteAttachmentsForMirror(note.body ?? '').trim()
  const titleHeading = note.title ? `# ${note.title}\n` : ''
  const content = `${frontmatter}\n\n${titleHeading}${body ? (titleHeading ? '\n' : '') + body + '\n' : ''}`
  const baseName = note.title ? slugify(note.title) : ''
  const filename = `${baseName || note.id}.md`
  return { filename, content }
}

// ─── Area → Markdown ──────────────────────────────────────────

export function areaToMarkdown(
  area: AreaRecord,
): { filename: string; content: string } {
  const frontmatter = buildFrontmatter({
    id: area.id,
    type: 'area',
    name: area.name,
    emoji: area.emoji,
    status: area.status,
    sortOrder: area.sortOrder,
    description: area.description,
    attachments: attachmentsForFrontmatter(area.attachments),
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
  })

  const parts: string[] = [frontmatter, '', `# ${area.emoji ? area.emoji + ' ' : ''}${area.name}`]
  if (area.description) parts.push('', area.description)
  if (area.notes) parts.push('', '## Notes', '', area.notes)
  if (area.userContext) parts.push('', '## Context', '', area.userContext)
  const content = parts.join('\n') + '\n'
  const filename = `${slugify(area.name) || area.id}.md`
  return { filename, content }
}
