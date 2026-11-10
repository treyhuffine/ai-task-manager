/**
 * Ranking and query parsing for the `@`-picker. Pure functions, deliberately
 * free of Tiptap and React imports so the ordering rules can be tested
 * directly — `extension.ts` is only the wiring around this.
 *
 * Tasks and notes arrive already searched and ranked by the server (the
 * whole home, this chat and this agent first), so they're placed here, not
 * scored. Agents, files, reference folders, issues and PRs are ranked locally.
 */

import type {
  MentionItem,
  AgentMentionItem,
  FileMentionItem,
  FilterMentionItem,
  MentionFilter,
  ReferenceFolderMentionItem,
  PrMentionMenuItem,
  IssueMentionMenuItem,
  MentionEntityResults,
  MentionEntitySearch,
  MoreMentionItem,
} from './types'
import type { IssueMentionItem, PrMentionItem } from '../github-refs/types'
import { GITHUB_QUERY_PREFIX } from './github-trigger'

export type { MentionFilter }

export const MAX_FILES = 30
/**
 * Tasks, notes, and agents, in the mixed `@` list. Each kind ends with an
 * "All N" row when more matched, which narrows to that kind.
 */
export const ENTITY_PREVIEW_LIMIT = 6
/** Rows in a list narrowed to one kind (`@task:`, `@note:`, `@agent:`, `@file:`, `@#`). */
export const NARROWED_LIMIT = 50
export const MAX_REFERENCES = 8

export interface ParsedMentionQuery {
  filter: MentionFilter | null
  /** The search itself, after any filter prefix. */
  text: string
}

export interface MentionKind {
  filter: MentionFilter
  /** Its chip, plural like the section headers. */
  label: string
  /** What narrows the picker to it when typed after the `@`. */
  prefix: string
  /**
   * Its names in full, which a kind suggestion matches the start of (`ta`).
   * Issues and PRs answer to either (`is`, `pr`).
   */
  names: readonly string[]
}

/**
 * The kinds the picker narrows to, in the order their chips show. `task:`
 * reads like the `[[task:id]]` markers chips become, and `#` is GitHub's
 * own syntax for issues and pull requests alike. `app:` lists every app and
 * connector a chat can use, `connector:` only connected accounts.
 */
export const MENTION_KINDS: readonly MentionKind[] = [
  { filter: 'task', label: 'Tasks', prefix: 'task:', names: ['tasks'] },
  { filter: 'note', label: 'Notes', prefix: 'note:', names: ['notes'] },
  { filter: 'agent', label: 'Agents', prefix: 'agent:', names: ['agents'] },
  { filter: 'app', label: 'Apps', prefix: 'app:', names: ['apps'] },
  { filter: 'connector', label: 'Connectors', prefix: 'connector:', names: ['connectors'] },
  { filter: 'file', label: 'Files', prefix: 'file:', names: ['files'] },
  { filter: 'github', label: 'Issues & PRs', prefix: GITHUB_QUERY_PREFIX, names: ['issues', 'prs'] },
]

export function mentionKind(filter: MentionFilter): MentionKind {
  const kind = MENTION_KINDS.find((k) => k.filter === filter)
  if (!kind) throw new Error(`Unknown mention filter: ${filter}`)
  return kind
}

/** The word prefixes, singular and plural (`task:`, `tasks:`), case aside. */
const FILTER_PREFIXES: ReadonlyArray<readonly [string, MentionFilter]> = MENTION_KINDS.flatMap((kind) =>
  kind.prefix === GITHUB_QUERY_PREFIX
    ? []
    : [[kind.prefix, kind.filter] as const, ...kind.names.map((name) => [`${name}:`, kind.filter] as const)],
)

export function parseMentionQuery(query: string): ParsedMentionQuery {
  if (query.startsWith(GITHUB_QUERY_PREFIX)) {
    return { filter: 'github', text: query.slice(GITHUB_QUERY_PREFIX.length) }
  }
  const lower = query.toLowerCase()
  for (const [prefix, filter] of FILTER_PREFIXES) {
    if (lower.startsWith(prefix)) return { filter, text: query.slice(prefix.length).trim() }
  }
  return { filter: null, text: query }
}

/**
 * Task and note titles have spaces, and so do agent, app and account names,
 * so a query narrowed to them may too (`@task:deploy keys`, `@agent:job
 * search`). Everything else ends at a space as before, which keeps a
 * mid-sentence `@` from swallowing the rest of the sentence.
 */
function filterAllowsSpaces(filter: MentionFilter | null): boolean {
  return filter === 'task' || filter === 'note' || filter === 'agent' || filter === 'app' || filter === 'connector'
}

export function queryAllowsSpaces(query: string): boolean {
  return filterAllowsSpaces(parseMentionQuery(query).filter)
}

/**
 * The text that narrows the picker to one kind (null: every kind), keeping
 * the search. A search with a space can't move to a kind whose query ends
 * at one, since the picker would close on it, so that kind starts empty.
 */
export function filterQueryText(filter: MentionFilter | null, text: string): string {
  const prefix = filter ? mentionKind(filter).prefix : ''
  return `@${prefix}${filterAllowsSpaces(filter) || !/\s/.test(text) ? text : ''}`
}

/** One letter starts too many titles to suggest a kind for. */
export const KIND_SUGGESTION_MIN_LENGTH = 2

/**
 * Kinds whose name starts with what's typed after the `@` (`ta`, `notes`),
 * offered above the results. Picking one rewrites the query to its prefix
 * (`@task:`) and the search goes on inside that kind. Only for a plain word:
 * a filter, a path or an issue or PR number already says what it's after.
 */
export function kindSuggestions(query: string): FilterMentionItem[] {
  const q = query.toLowerCase()
  if (q.length < KIND_SUGGESTION_MIN_LENGTH || !/^[a-z]+$/.test(q)) return []
  return MENTION_KINDS.filter((kind) => kind.names.some((name) => name.startsWith(q))).map((kind) => ({
    kind: 'filter',
    filter: kind.filter,
    query: '',
  }))
}

/**
 * What to ask the server for, or null when this query shows no tasks or
 * notes (issues and pull requests, files, or inside a reference folder).
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

/**
 * Rank agents on their name or slug (`Job Search`, `job-search`), whichever
 * matches better. No search keeps the rail's order.
 */
export function rankAgents(agents: AgentMentionItem[], query: string): AgentMentionItem[] {
  if (!query) return agents
  const q = query.toLowerCase()
  return agents
    .map((item) => ({ item, score: Math.min(scoreText(item.name, q), scoreText(item.slug, q)) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => a.score - b.score || a.item.name.length - b.item.name.length)
    .map((s) => s.item)
}

/** Ranked agents, ending with how many more matched when some didn't fit. */
function agentRows(agents: AgentMentionItem[], text: string, narrowed: boolean): MentionItem[] {
  const ranked = rankAgents(agents, text)
  const rows: MentionItem[] = ranked.slice(0, narrowed ? NARROWED_LIMIT : ENTITY_PREVIEW_LIMIT)
  if (ranked.length > rows.length) {
    rows.push({ kind: 'more', of: 'agent', total: ranked.length, shown: rows.length, query: text, narrowed })
  }
  return rows
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

type GithubRefItem = PrMentionMenuItem | IssueMentionMenuItem

/** Newest activity first, which is what someone picking one mid-conversation is almost always after. */
function byRecency(a: GithubRefItem, b: GithubRefItem): number {
  if (a.updatedAt === b.updatedAt) return 0
  return a.updatedAt < b.updatedAt ? 1 : -1
}

/**
 * Rank issues and pull requests together for the `@#` picker, the way
 * GitHub's own `#` lists them: one list, since the two share one number
 * space in a repository. `query` is the text after the `#` (already stripped
 * by the caller).
 *
 * A pure-digit query matches the number: exact, then number-prefix, then
 * number-substring, so `@#22` puts #22 above #221 and #322. A text query
 * matches the title (prefix beats substring) and then a PR's head branch.
 * Ties, and an empty query, go newest activity first. Every match comes back.
 * The caller caps the rows.
 */
export function rankGithubRefs(
  prs: PrMentionItem[],
  issues: IssueMentionItem[],
  query: string,
): GithubRefItem[] {
  const all: GithubRefItem[] = [
    ...prs.map((pr): GithubRefItem => ({ kind: 'pr', ...pr })),
    ...issues.map((issue): GithubRefItem => ({ kind: 'issue', ...issue })),
  ].sort(byRecency)
  if (!query) return all

  const q = query.toLowerCase()
  const score = /^\d+$/.test(query)
    ? (item: GithubRefItem) => {
        const num = String(item.number)
        if (num === query) return 0
        if (num.startsWith(query)) return 1
        if (num.includes(query)) return 2
        return Infinity
      }
    : (item: GithubRefItem) => {
        const title = item.title.toLowerCase()
        if (title.startsWith(q)) return 0
        if (title.includes(q)) return 1
        if (item.kind === 'pr' && item.headRefName.toLowerCase().includes(q)) return 2
        return Infinity
      }
  // A stable sort, so equal scores keep the recency order above.
  return all
    .map((item) => ({ item, score: score(item) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => a.score - b.score)
    .map((s) => s.item)
}

/** Ranked issues and PRs, with a caption saying how many matched when some didn't fit. */
function githubRows(prs: PrMentionItem[], issues: IssueMentionItem[], text: string): MentionItem[] {
  const ranked = rankGithubRefs(prs, issues, text)
  const rows: MentionItem[] = ranked.slice(0, NARROWED_LIMIT)
  if (ranked.length > rows.length) {
    rows.push({ kind: 'more', of: 'github', total: ranked.length, shown: rows.length, query: text, narrowed: true })
  }
  return rows
}

export interface ReferenceDrillDown {
  reference: ReferenceFolderMentionItem
  rest: string
}

/**
 * A query of the form `alias/rest` means the user has drilled into a
 * reference folder, either by typing `/` after its chip or by typing the
 * whole path.
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
 * A linked folder is a complete mention in its own right. Its chip carries
 * the absolute path, including when the folder is on another device.
 */
export function toReferenceMention(
  reference: ReferenceFolderMentionItem,
): FileMentionItem {
  return { kind: 'dir', path: reference.absolutePath, name: reference.alias, label: reference.alias, referenceAlias: reference.alias }
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
  of: 'task' | 'note',
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
 * (scratchpad, then a few tasks, notes and agents, each kind ending with an
 * "All N" row that narrows to it), followed by reference folders and file
 * matches. A path-like query (`src/`, `.tsx`) puts files first instead, so
 * a home full of tasks never buries the file being named.
 *
 * A filter after the `@` narrows to one kind: `task:`, `note:`, `agent:` and
 * `#` for issues and pull requests (up to NARROWED_LIMIT rows, with a caption
 * when more matched), and `file:`.
 *
 * Inside a drill-down (`@alias/…`) that reference's files lead, since the user
 * has said exactly where they are looking — but worktree matches still follow
 * underneath, so an alias that happens to share a name with a real folder
 * doesn't make that folder unreachable.
 */
export function buildItems(args: {
  files: FileMentionItem[]
  /** Agents this chat can mention, in the rail's order. */
  agents?: AgentMentionItem[]
  /** The server's tasks and notes for this query. Null when it wasn't asked, or failed. */
  entities: MentionEntityResults | null
  references: ReferenceFolderMentionItem[]
  referenceFiles: FileMentionItem[] | null
  prs: PrMentionItem[]
  issues: IssueMentionItem[]
  drillDown: ReferenceDrillDown | null
  query: string
}): MentionItem[] {
  const { files, agents = [], entities, references, referenceFiles, prs, issues, drillDown, query } = args
  const parsed = parseMentionQuery(query)

  // Checked before everything else so a filter wins even if the remainder
  // looks like a file query.
  if (parsed.filter === 'app' || parsed.filter === 'connector') return []
  if (parsed.filter === 'github') return githubRows(prs, issues, parsed.text)
  if (parsed.filter === 'file') return rankFiles(files, parsed.text, NARROWED_LIMIT)
  if (parsed.filter === 'agent') return agentRows(agents, parsed.text, true)
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
  out.push(...agentRows(agents, query, false))
  for (const r of rankReferences(references, query)) out.push(r)

  const fileRows = rankFiles(files, query)
  return looksLikePath(query) ? [...fileRows, ...out] : [...out, ...fileRows]
}
