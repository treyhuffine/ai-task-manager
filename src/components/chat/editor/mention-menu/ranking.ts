/**
 * Ranking and query parsing for the `@`-picker. Pure functions, deliberately
 * free of Tiptap and React imports so the ordering rules can be tested
 * directly — `extension.ts` is only the wiring around this.
 */

import type {
  MentionItem,
  FileMentionItem,
  TaskMentionItem,
  NoteMentionItem,
  ReferenceFolderMentionItem,
  PrMentionMenuItem,
} from './types'
import type { PrMentionItem } from '../pr-menu/types'
import { PR_QUERY_PREFIX } from './pr-trigger'

export const MAX_FILES = 30
export const MAX_TASKS = 15
export const MAX_NOTES = 15
export const MAX_REFERENCES = 8
export const MAX_PRS = 30

const COMMON_NOISE_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  '.turbo',
  '.cache',
])

function scoreFile(item: FileMentionItem, q: string): number {
  const lowerPath = item.path.toLowerCase()
  const lowerName = item.name.toLowerCase()
  if (lowerName === q) return 0
  if (lowerName.startsWith(q)) return 1
  if (lowerPath.endsWith('/' + q)) return 2
  if (lowerName.includes(q)) return 3
  if (lowerPath.includes(q)) return 4
  return Infinity
}

function scoreText(text: string, q: string): number {
  const lower = text.toLowerCase()
  if (lower === q) return 0
  if (lower.startsWith(q)) return 1
  if (lower.includes(q)) return 2
  return Infinity
}

export function rankFiles(entries: FileMentionItem[], query: string): FileMentionItem[] {
  if (!query) {
    const filtered = entries.filter((e) => {
      const top = e.path.split('/')[0] ?? ''
      return !COMMON_NOISE_DIRS.has(top)
    })
    const files = filtered.filter((e) => e.kind === 'file').slice(0, MAX_FILES)
    const dirs = filtered.filter((e) => e.kind === 'dir').slice(0, MAX_FILES - files.length)
    return [...files, ...dirs]
  }
  const q = query.toLowerCase()
  return entries
    .map((item) => ({ item, score: scoreFile(item, q) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      if (a.item.kind !== b.item.kind) return a.item.kind === 'file' ? -1 : 1
      return a.item.path.length - b.item.path.length
    })
    .slice(0, MAX_FILES)
    .map((s) => s.item)
}

/**
 * Rank files that came out of a reference folder. Scored on the `alias/rel`
 * label rather than the absolute path — matching on the absolute path would
 * let the user's home directory name score hits, which is noise.
 */
function rankReferenceFiles(entries: FileMentionItem[], query: string): FileMentionItem[] {
  if (!query) return entries.slice(0, MAX_FILES)
  const q = query.toLowerCase()
  return entries
    .map((item) => ({
      item,
      // Score against the relative portion, which is what the user is typing.
      score: scoreFile({ ...item, path: item.label ?? item.path }, q),
    }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      const aLen = (a.item.label ?? a.item.path).length
      const bLen = (b.item.label ?? b.item.path).length
      return aLen - bLen
    })
    .slice(0, MAX_FILES)
    .map((s) => s.item)
}

export function rankTasks(tasks: TaskMentionItem[], query: string): TaskMentionItem[] {
  if (!query) {
    // Active first; within each status keep stored order (server returns
    // by recency).
    const active = tasks.filter((t) => t.status === 'active')
    const rest = tasks.filter((t) => t.status !== 'active')
    return [...active, ...rest].slice(0, MAX_TASKS)
  }
  const q = query.toLowerCase()
  return tasks
    .map((item) => ({ item, score: scoreText(item.title, q) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      // Tiebreak: active tasks before done/archived.
      const aActive = a.item.status === 'active' ? 0 : 1
      const bActive = b.item.status === 'active' ? 0 : 1
      return aActive - bActive
    })
    .slice(0, MAX_TASKS)
    .map((s) => s.item)
}

export function rankNotes(notes: NoteMentionItem[], query: string): NoteMentionItem[] {
  if (!query) return notes.slice(0, MAX_NOTES)
  const q = query.toLowerCase()
  return notes
    .map((item) => ({ item, score: scoreText(item.title, q) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_NOTES)
    .map((s) => s.item)
}

export function rankReferences(
  refs: ReferenceFolderMentionItem[],
  query: string,
): ReferenceFolderMentionItem[] {
  if (!query) return refs.slice(0, MAX_REFERENCES)
  const q = query.toLowerCase()
  return refs
    .map((item) => ({ item, score: scoreText(item.alias, q) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => a.score - b.score || a.item.alias.length - b.item.alias.length)
    .slice(0, MAX_REFERENCES)
    .map((s) => s.item)
}

function toPrItem(pr: PrMentionItem): PrMentionMenuItem {
  return { kind: 'pr', ...pr }
}

/**
 * Rank pull requests for the `@#` picker. `query` is the text after the
 * `#` prefix (already stripped by the caller).
 *
 * A pure-digit query filters by PR number — exact, then number-prefix,
 * then number-substring — so typing `@#22` surfaces #22 above #221 / #322
 * rather than an arbitrary ordering. A text query matches the title
 * (prefix beats substring) and then the head branch, tie-broken by
 * recency since the feed already arrives newest-first.
 */
export function rankPrs(prs: PrMentionItem[], query: string): PrMentionMenuItem[] {
  if (!query) return prs.slice(0, MAX_PRS).map(toPrItem)

  if (/^\d+$/.test(query)) {
    const exact: PrMentionItem[] = []
    const startsWith: PrMentionItem[] = []
    const contains: PrMentionItem[] = []
    for (const p of prs) {
      const num = String(p.number)
      if (num === query) exact.push(p)
      else if (num.startsWith(query)) startsWith.push(p)
      else if (num.includes(query)) contains.push(p)
    }
    return [...exact, ...startsWith, ...contains].slice(0, MAX_PRS).map(toPrItem)
  }

  const q = query.toLowerCase()
  type Scored = { item: PrMentionItem; score: number }
  const scored: Scored[] = []
  for (const p of prs) {
    const title = p.title.toLowerCase()
    const branch = p.headRefName.toLowerCase()
    let score: number
    if (title.startsWith(q)) score = 0
    else if (title.includes(q)) score = 1
    else if (branch.includes(q)) score = 2
    else continue
    scored.push({ item: p, score })
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    // Tiebreak by recency (feed is already sorted newest-first).
    return a.item.updatedAt < b.item.updatedAt ? 1 : -1
  })
  return scored.slice(0, MAX_PRS).map((s) => toPrItem(s.item))
}

export interface ReferenceDrillDown {
  reference: ReferenceFolderMentionItem
  rest: string
}

/**
 * A query of the form `alias/rest` means the user has drilled into a
 * reference folder — either by picking it from the list (which rewrites the
 * text to `@alias/`) or by typing the whole thing.
 *
 * Returns null when nothing before the first slash matches a known alias, so
 * ordinary worktree paths like `src/lib/foo.ts` fall through untouched.
 */
export function parseReferenceDrillDown(
  query: string,
  refs: ReferenceFolderMentionItem[],
): ReferenceDrillDown | null {
  const slash = query.indexOf('/')
  if (slash <= 0) return null
  const alias = query.slice(0, slash).toLowerCase()
  const reference = refs.find((r) => r.alias === alias)
  if (!reference) return null
  return { reference, rest: query.slice(slash + 1) }
}

/**
 * Turn a reference folder's relative paths into pickable items. The chip
 * carries the ABSOLUTE path, because that is what the agent acts on and it
 * needs no prompt-side expansion. The label stays `alias/relative` so the
 * transcript reads like something a human wrote.
 */
export function toReferenceFileItems(
  reference: ReferenceFolderMentionItem,
  entries: FileMentionItem[],
): FileMentionItem[] {
  const root = reference.absolutePath.replace(/\/+$/, '')
  return entries.map((entry) => ({
    kind: entry.kind,
    // Joined as POSIX rather than via `path` — this runs in the browser.
    path: `${root}/${entry.path}`,
    name: entry.name,
    label: `${reference.alias}/${entry.path}`,
    referenceAlias: reference.alias,
  }))
}

/**
 * Build the full picker list — entity options come first (scratchpad always,
 * then tasks then notes), followed by reference folders and then file
 * matches. The user almost always wants scratchpad / a known task before a
 * file path; files tend to be longer and more specific, and surface naturally
 * as the query narrows.
 *
 * Inside a drill-down (`@alias/…`) that reference's files lead, since the user
 * has said exactly where they are looking — but worktree matches still follow
 * underneath, so an alias that happens to share a name with a real folder
 * doesn't make that folder unreachable.
 *
 * A query that opens with `#` (`@#…`) is the pull-request filter: it returns
 * PRs only, keeping the default file/task/note list uncluttered.
 */
export function buildItems(args: {
  files: FileMentionItem[]
  tasks: TaskMentionItem[]
  notes: NoteMentionItem[]
  references: ReferenceFolderMentionItem[]
  referenceFiles: FileMentionItem[] | null
  prs: PrMentionItem[]
  drillDown: ReferenceDrillDown | null
  query: string
}): MentionItem[] {
  const { files, tasks, notes, references, referenceFiles, prs, drillDown, query } = args

  // `@#…` — pull-request mode. Checked before everything else so the `#`
  // discriminator wins even if the remainder looks like a file query.
  if (query.startsWith(PR_QUERY_PREFIX)) {
    return rankPrs(prs, query.slice(PR_QUERY_PREFIX.length))
  }

  const q = query.toLowerCase()
  const out: MentionItem[] = []

  if (drillDown) {
    if (referenceFiles) {
      for (const f of rankReferenceFiles(referenceFiles, drillDown.rest)) out.push(f)
    }
    for (const f of rankFiles(files, query)) out.push(f)
    return out
  }

  // Scratchpad: surface when the query is empty OR matches "scratch" /
  // "pad" / "scratchpad". Filtering instead of always-present so the
  // option doesn't clutter every search.
  if (!q || 'scratchpad'.includes(q) || 'pad'.includes(q)) {
    out.push({ kind: 'scratchpad' })
  }

  for (const t of rankTasks(tasks, query)) out.push(t)
  for (const n of rankNotes(notes, query)) out.push(n)
  for (const r of rankReferences(references, query)) out.push(r)
  for (const f of rankFiles(files, query)) out.push(f)
  return out
}
