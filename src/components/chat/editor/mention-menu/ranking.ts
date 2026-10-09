/**
 * Ranking and query parsing for the `@`-picker. Pure functions, deliberately
 * free of Tiptap and React imports so the ordering rules can be tested
 * directly — `extension.ts` is only the wiring around this.
 *
 * Tasks and notes arrive already searched and ranked by the server (the
 * whole home, this chat and this agent first), so they're placed here, not
 * scored. Files, reference folders and PRs are ranked locally.
 */

import type {
  MentionItem,
  FileMentionItem,
  ReferenceFolderMentionItem,
  PrMentionMenuItem,
  MentionEntityResults,
  MentionEntitySearch,
  MoreMentionItem,
} from './types'
import type { PrMentionItem } from '../pr-menu/types'
import { PR_QUERY_PREFIX } from './pr-trigger'

export const MAX_FILES = 30
/**
 * Tasks, and notes, in the mixed `@` list. Each kind ends with an "All N"
 * row when more matched, which narrows to that kind.
 */
export const ENTITY_PREVIEW_LIMIT = 6
/** Rows in a list narrowed to one kind (`@task:`, `@note:`, `@file:`). */
export const NARROWED_LIMIT = 50
export const MAX_REFERENCES = 8
export const MAX_PRS = 30

/** What a query narrows the picker to, read from how it opens. */
export type MentionFilter = 'task' | 'note' | 'file' | 'pr' | 'app' | 'connector'

export interface ParsedMentionQuery {
  filter: MentionFilter | null
  /** The search itself, after any filter prefix. */
  text: string
}

/**
 * Filter prefixes after the `@`. `task:` reads like the `[[task:id]]`
 * markers chips become, and `#` is GitHub's own PR syntax.
 */
const FILTER_PREFIXES: ReadonlyArray<readonly [string, MentionFilter]> = [
  ['task:', 'task'],
  ['tasks:', 'task'],
  ['app:', 'app'],
  ['apps:', 'app'],
  ['connector:', 'connector'],
  ['connectors:', 'connector'],
  ['note:', 'note'],
  ['notes:', 'note'],
  ['file:', 'file'],
  ['files:', 'file'],
]

export function parseMentionQuery(query: string): ParsedMentionQuery {
  if (query.startsWith(PR_QUERY_PREFIX)) {
    return { filter: 'pr', text: query.slice(PR_QUERY_PREFIX.length) }
  }
  const lower = query.toLowerCase()
  for (const [prefix, filter] of FILTER_PREFIXES) {
    if (lower.startsWith(prefix)) return { filter, text: query.slice(prefix.length).trim() }
  }
  return { filter: null, text: query }
}

/**
 * Task and note titles have spaces, so a query narrowed to them may too
 * (`@task:deploy keys`). Everything else ends at a space as before, which
 * keeps a mid-sentence `@` from swallowing the rest of the sentence.
 */
export function queryAllowsSpaces(query: string): boolean {
  const { filter } = parseMentionQuery(query)
  return filter === 'task' || filter === 'note' || filter === 'app' || filter === 'connector'
}

/** The text that narrows the picker to one kind, keeping the search. */
export function narrowedQueryText(of: 'task' | 'note' | 'app', text: string): string {
  return `@${of}:${text}`
}

/**
 * What to ask the server for, or null when this query shows no tasks or
 * notes (pull requests, files, or inside a reference folder).
 */
export function entitySearchFor(
  parsed: ParsedMentionQuery,
  inDrillDown: boolean,
): MentionEntitySearch | null {
  if (parsed.filter === 'task' || parsed.filter === 'note') {
    return { q: parsed.text, kind: parsed.filter, limit: NARROWED_LIMIT }
  }
  if (parsed.filter || inDrillDown) return null
  return { q: parsed.text, limit: ENTITY_PREVIEW_LIMIT }
}

/** `src/app`, `page.tsx`: the user is after a file, so files lead. */
function looksLikePath(query: string): boolean {
  return /[/.]/.test(query)
}

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

export function rankFiles(entries: FileMentionItem[], query: string, limit = MAX_FILES): FileMentionItem[] {
  if (!query) {
    const filtered = entries.filter((e) => {
      const top = e.path.split('/')[0] ?? ''
      return !COMMON_NOISE_DIRS.has(top)
    })
    const files = filtered.filter((e) => e.kind === 'file').slice(0, limit)
    const dirs = filtered.filter((e) => e.kind === 'dir').slice(0, limit - files.length)
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
    .slice(0, limit)
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
 * Whether a reference folder's files can be listed from here: it's there,
 * and on this machine. A chat on another device lists its linked folders at
 * their paths there, which the home can't browse.
 */
export function canBrowseReference(reference: ReferenceFolderMentionItem): boolean {
  return reference.exists && reference.browsable !== false
}

/**
 * What picking a reference folder does: drill into its files (rewriting the
 * query to `@alias/`), or, when its files are on another device, mention the
 * folder itself at its path there.
 */
export function pickReference(
  reference: ReferenceFolderMentionItem,
): { kind: 'drill'; text: string } | { kind: 'chip'; chip: FileMentionItem } {
  if (reference.browsable === false && reference.exists) {
    return {
      kind: 'chip',
      chip: { kind: 'dir', path: reference.absolutePath, name: reference.alias, label: reference.alias, referenceAlias: reference.alias },
    }
  }
  return { kind: 'drill', text: `@${reference.alias}/` }
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

/** One kind's server results, ending with how many more matched when some didn't fit. */
function entityRows(
  results: MentionEntityResults | null,
  of: 'task' | 'note' | 'app',
  text: string,
  narrowed: boolean,
): MentionItem[] {
  const rows: MentionItem[] = of === 'task' ? [...(results?.tasks ?? [])] : [...(results?.notes ?? [])]
  const total = of === 'task' ? results?.totals.tasks ?? 0 : results?.totals.notes ?? 0
  if (total > rows.length) {
    const more: MoreMentionItem = { kind: 'more', of, total, shown: rows.length, query: text, narrowed }
    rows.push(more)
  }
  return rows
}

/**
 * Build the full picker list. By default entity options come first
 * (scratchpad, then a few tasks, then a few notes, each kind ending with an
 * "All N" row that narrows to it), followed by reference folders and file
 * matches. A path-like query (`src/`, `.tsx`) puts files first instead, so
 * a home full of tasks never buries the file being named.
 *
 * A filter after the `@` narrows to one kind: `task:` and `note:` (up to
 * NARROWED_LIMIT rows, with a caption when more matched), `file:`, and `#`
 * for pull requests.
 *
 * Inside a drill-down (`@alias/…`) that reference's files lead, since the user
 * has said exactly where they are looking — but worktree matches still follow
 * underneath, so an alias that happens to share a name with a real folder
 * doesn't make that folder unreachable.
 */
export function buildItems(args: {
  files: FileMentionItem[]
  /** The server's tasks and notes for this query. Null when it wasn't asked, or failed. */
  entities: MentionEntityResults | null
  references: ReferenceFolderMentionItem[]
  referenceFiles: FileMentionItem[] | null
  prs: PrMentionItem[]
  drillDown: ReferenceDrillDown | null
  query: string
}): MentionItem[] {
  const { files, entities, references, referenceFiles, prs, drillDown, query } = args
  const parsed = parseMentionQuery(query)

  // Checked before everything else so a filter wins even if the remainder
  // looks like a file query.
  if (parsed.filter === 'app' || parsed.filter === 'connector') return []
  if (parsed.filter === 'pr') return rankPrs(prs, parsed.text)
  if (parsed.filter === 'file') return rankFiles(files, parsed.text, NARROWED_LIMIT)
  if (parsed.filter === 'task' || parsed.filter === 'note') {
    return entityRows(entities, parsed.filter, parsed.text, true)
  }

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
  const q = query.toLowerCase()
  if (!q || 'scratchpad'.includes(q) || 'pad'.includes(q)) {
    out.push({ kind: 'scratchpad' })
  }

  out.push(...entityRows(entities, 'task', query, false))
  out.push(...entityRows(entities, 'note', query, false))
  for (const r of rankReferences(references, query)) out.push(r)

  const fileRows = rankFiles(files, query)
  return looksLikePath(query) ? [...fileRows, ...out] : [...out, ...fileRows]
}
