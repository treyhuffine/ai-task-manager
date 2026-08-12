/**
 * Ranking for the `/`-picker. Pure functions, deliberately free of Tiptap and
 * React imports so the ordering rules can be tested directly — `extension.ts`
 * is only the wiring around this.
 *
 * The rule that matters: a match on the command NAME always outranks a match
 * on the description. Before this module the menu was a bare `Array.filter`
 * over `name.includes(q) || description.includes(q)` with no sort, so `/impl`
 * buried `implementing-specs` under every skill whose description happened to
 * contain "implement".
 */

import type { SlashCommand } from './types'

/** Separators that break a command name into segments: `plan-design-review`. */
const SEGMENT_CHARS = new Set(['-', '_', '/', '.', ':', ' '])

/** Characters that count as a word boundary inside a description. */
const DESCRIPTION_BOUNDARY = /[^a-z0-9]/

/**
 * How the query matched. The tier is the dominant term in the score — see
 * `TIER_STRIDE` — so everything below is ordered strictly after everything
 * above it, no matter how heavily used a command is.
 */
export const TIER = {
  /** `qa` for query `qa`. */
  exactName: 0,
  /** `implementing-specs` for query `impl`. */
  namePrefix: 1,
  /** `plan-design-review` for query `design`. */
  segmentPrefix: 2,
  /** `plan-design-review` for query `pdr`. */
  acronym: 3,
  /** `geo-citability` for query `gcit`. */
  nameFuzzy: 4,
  /** description contains the query at a word boundary. */
  descriptionWord: 5,
  /** description contains the query mid-word. */
  descriptionSubstring: 6,
} as const

const TIER_STRIDE = 1000

/**
 * Both intra-tier adjustments are capped below half the stride. That is what
 * makes tier promotion impossible: the worst score in tier N is
 * `N*1000 + 499`, the best in tier N+1 is `(N+1)*1000 - 499 = N*1000 + 501`.
 * A command you run fifty times a day can reorder its own tier and nothing
 * else.
 */
const MAX_POSITION_PENALTY = 499
const MAX_FRECENCY_BONUS = 499

export interface CommandMatch {
  command: SlashCommand
  /** Lower sorts first. */
  score: number
  /** Which `TIER` produced the hit. Null when the query was empty. */
  tier: number | null
  /** Char offsets into `command.name` to highlight. */
  nameMatches: number[]
  /** Char offsets into `command.description` to highlight. */
  descriptionMatches: number[]
}

function clampPenalty(value: number): number {
  if (value < 0) return 0
  return value > MAX_POSITION_PENALTY ? MAX_POSITION_PENALTY : value
}

function range(start: number, length: number): number[] {
  const out: number[] = []
  for (let i = 0; i < length; i++) out.push(start + i)
  return out
}

/**
 * Offsets of the first character of each segment. `plan-design-review` →
 * `[0, 5, 12]`. Drives both the segment-prefix tier and the acronym tier, and
 * gives the fuzzy scorer its boundary bonus.
 */
function segmentStarts(name: string): number[] {
  const starts: number[] = []
  let atStart = true
  for (let i = 0; i < name.length; i++) {
    if (SEGMENT_CHARS.has(name[i]!)) {
      atStart = true
      continue
    }
    if (atStart) {
      starts.push(i)
      atStart = false
    }
  }
  return starts
}

interface Hit {
  tier: number
  penalty: number
  indices: number[]
}

/**
 * Subsequence match, Sublime-style. Two passes: a greedy forward scan proves
 * the query fits and finds where the run can end, then a backward scan from
 * that end pulls every character as far right as it will go. The second pass
 * is what collapses the run to its tightest form — greedy-forward alone
 * matches `abc` against `aabc` as `0,2,3` instead of `1,2,3`.
 */
function fuzzyMatch(text: string, q: string, starts: number[]): Hit | null {
  let ti = 0
  for (let qi = 0; qi < q.length; qi++) {
    while (ti < text.length && text[ti] !== q[qi]) ti++
    if (ti >= text.length) return null
    ti++
  }

  const indices = new Array<number>(q.length)
  let bi = ti - 1
  for (let qi = q.length - 1; qi >= 0; qi--) {
    while (text[bi] !== q[qi]) bi--
    indices[qi] = bi
    bi--
  }

  const boundaries = new Set(starts)
  const first = indices[0]!
  const last = indices[q.length - 1]!
  // Characters skipped *inside* the matched span. A contiguous run scores 0.
  const gaps = last - first + 1 - q.length
  const onBoundary = indices.reduce((n, i) => (boundaries.has(i) ? n + 1 : n), 0)
  return {
    tier: TIER.nameFuzzy,
    penalty: clampPenalty(first * 2 + gaps * 6 - onBoundary * 4),
    indices,
  }
}

function matchName(name: string, q: string): Hit | null {
  if (name === q) {
    return { tier: TIER.exactName, penalty: 0, indices: range(0, name.length) }
  }
  if (name.startsWith(q)) {
    return { tier: TIER.namePrefix, penalty: 0, indices: range(0, q.length) }
  }

  const starts = segmentStarts(name)

  // Segment prefix: `/design` finds `plan-design-review`. Later segments take
  // a small penalty so an earlier one wins when both match.
  for (let s = 0; s < starts.length; s++) {
    if (name.startsWith(q, starts[s]!)) {
      return {
        tier: TIER.segmentPrefix,
        penalty: clampPenalty(s * 8),
        indices: range(starts[s]!, q.length),
      }
    }
  }

  // Acronym: `pdr` finds `plan-design-review`. Requires two segments and two
  // query characters — a single letter would "acronym-match" half the list,
  // and the name-prefix tier already covers that case properly.
  if (q.length >= 2 && starts.length >= 2) {
    let initials = ''
    for (const i of starts) initials += name[i]!
    if (initials.startsWith(q)) {
      // Covering every segment is a better acronym than covering a prefix.
      return {
        tier: TIER.acronym,
        penalty: clampPenalty((initials.length - q.length) * 8),
        indices: starts.slice(0, q.length),
      }
    }
  }

  return fuzzyMatch(name, q, starts)
}

function matchDescription(description: string, q: string): Hit | null {
  let anywhere = -1
  for (let i = description.indexOf(q); i >= 0; i = description.indexOf(q, i + 1)) {
    if (anywhere < 0) anywhere = i
    // Word-prefix beats mid-word: "implement the spec" is a stronger signal
    // for `impl` than "reimplementation" is.
    if (i === 0 || DESCRIPTION_BOUNDARY.test(description[i - 1]!)) {
      return { tier: TIER.descriptionWord, penalty: clampPenalty(i), indices: range(i, q.length) }
    }
  }
  if (anywhere < 0) return null
  return {
    tier: TIER.descriptionSubstring,
    penalty: clampPenalty(anywhere),
    indices: range(anywhere, q.length),
  }
}

/**
 * Normalize raw frecency into the bounded bonus. Scaled by sqrt against the
 * busiest command rather than linearly: linear scaling lets one dominant skill
 * flatten every other command's bonus to near zero, so a skill used five times
 * would rank the same as one never used at all.
 */
function frecencyBonuses(commands: SlashCommand[]): Map<string, number> {
  const out = new Map<string, number>()
  let max = 0
  for (const c of commands) {
    const f = c.frecency ?? 0
    if (f > max) max = f
  }
  if (max <= 0) return out
  for (const c of commands) {
    const f = c.frecency ?? 0
    if (f > 0) out.set(c.id, Math.round(Math.sqrt(f / max) * MAX_FRECENCY_BONUS))
  }
  return out
}

/**
 * Order the menu for `query`.
 *
 * Deliberately uncapped. Truncating would mean a skill the user is reaching
 * for can be missing from the list entirely, which reads as broken in a way
 * that a long list never does — the tiers put the right answer on top, and the
 * tail costs a scroll rather than a dead end.
 *
 * An empty query is browse mode: most-used first, then alphabetical.
 */
export function rankCommands(commands: SlashCommand[], query: string): CommandMatch[] {
  const q = query.trim().toLowerCase()

  if (!q) {
    return [...commands]
      .sort((a, b) => (b.frecency ?? 0) - (a.frecency ?? 0) || a.name.localeCompare(b.name))
      .map((command) => ({
        command,
        score: 0,
        tier: null,
        nameMatches: [],
        descriptionMatches: [],
      }))
  }

  const bonuses = frecencyBonuses(commands)
  const matches: CommandMatch[] = []

  for (const command of commands) {
    const bonus = bonuses.get(command.id) ?? 0
    const hit = matchName(command.name.toLowerCase(), q)
    if (hit) {
      matches.push({
        command,
        score: hit.tier * TIER_STRIDE + hit.penalty - bonus,
        tier: hit.tier,
        nameMatches: hit.indices,
        descriptionMatches: [],
      })
      continue
    }
    const description = command.description?.toLowerCase()
    if (!description) continue
    const descriptionHit = matchDescription(description, q)
    if (!descriptionHit) continue
    matches.push({
      command,
      score: descriptionHit.tier * TIER_STRIDE + descriptionHit.penalty - bonus,
      tier: descriptionHit.tier,
      nameMatches: [],
      descriptionMatches: descriptionHit.indices,
    })
  }

  return matches.sort(
    (a, b) =>
      a.score - b.score ||
      // Shorter name wins a tie, so `/qa` sits above `/qa-only`.
      a.command.name.length - b.command.name.length ||
      a.command.name.localeCompare(b.command.name),
  )
}

/**
 * Split `text` into runs for rendering, marking which characters the query
 * matched. Keeps the highlight logic out of the popup, which only has to pick
 * a class per segment.
 */
export function highlightSegments(
  text: string,
  matches: number[],
): { text: string; match: boolean }[] {
  if (matches.length === 0) return [{ text, match: false }]
  const hit = new Set(matches)
  const out: { text: string; match: boolean }[] = []
  let start = 0
  let current = hit.has(0)
  for (let i = 1; i <= text.length; i++) {
    const next = i < text.length && hit.has(i)
    if (next === current && i < text.length) continue
    out.push({ text: text.slice(start, i), match: current })
    start = i
    current = next
  }
  return out
}
