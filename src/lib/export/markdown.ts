// Markdown export utilities for tasks, notes, and areas.
// Produces a YAML-frontmatter + body string for a record. Frontmatter may
// include Obsidian-style [[wiki/links]] for foreign-key relations when a
// LinkResolver is provided (bulk-export context).
//
// One-way format: intended for backups and external tools. There is no
// corresponding import — a pristine DB-file backup is better for fidelity.

import slugifyLib from '@sindresorhus/slugify'
import type { TaskRecord, NoteRecord, AreaRecord } from '@/db/types'

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

// Minimal YAML value serializer — handles strings, numbers, booleans, null, arrays.
function yamlValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    return '[' + v.map((x) => yamlValue(x)).join(', ') + ']'
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
    area: wikiLink(opts.links, 'area', task.area_id) ?? opts.areaName ?? null,
    area_id: task.area_id,
    parent: wikiLink(opts.links, 'task', task.parent_id),
    parent_id: task.parent_id,
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
  })

  const parts: string[] = [frontmatter, '', `# ${task.title}`]
  const description = (task.description ?? '').trim()
  const body = (task.body ?? '').trim()
  const userContext = (task.user_context ?? '').trim()
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
    area: wikiLink(opts.links, 'area', note.area_id) ?? opts.areaName ?? null,
    area_id: note.area_id,
    task: wikiLink(opts.links, 'task', note.task_id),
    task_id: note.task_id,
    url: note.url,
    context_tags: note.context_tags,
    created_at: note.created_at,
    updated_at: note.updated_at,
  })

  const body = (note.body ?? '').trim()
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
    sort_order: area.sort_order,
    description: area.description,
    created_at: area.created_at,
    updated_at: area.updated_at,
  })

  const parts: string[] = [frontmatter, '', `# ${area.emoji ? area.emoji + ' ' : ''}${area.name}`]
  if (area.description) parts.push('', area.description)
  if (area.notes) parts.push('', '## Notes', '', area.notes)
  if (area.user_context) parts.push('', '## Context', '', area.user_context)
  const content = parts.join('\n') + '\n'
  const filename = `${slugify(area.name) || area.id}.md`
  return { filename, content }
}
