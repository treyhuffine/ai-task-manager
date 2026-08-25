/**
 * Markdown round-trip for the standalone collapsible `toggle` block.
 *
 * A toggle is a Notion-style disclosure: a `toggleSummary` (the always-visible
 * clickable line) plus a `toggleContent` body of arbitrary blocks that hides
 * when the toggle is closed. Unlike a heading fold — whose collapsed bit is kept
 * OUT of the markdown and persisted out-of-band (see collapsible-heading.tsx) —
 * a toggle is *structural*, so it must survive the markdown round-trip or the
 * body decomposes into loose paragraphs on the next external sync.
 *
 * We encode it as portable `<details>` HTML:
 *
 *     <details open>
 *     <summary>Summary line</summary>
 *
 *     Body block 1
 *
 *     Body block 2
 *
 *     </details>
 *
 * This renders natively on GitHub and most markdown viewers, degrades
 * gracefully if our tokenizer is ever removed (the text is never lost), and
 * carries the open/closed state in the native `open` attribute so no separate
 * tracking is needed.
 *
 * `@tiptap/markdown` runs on `marked`. `marked` block-extension tokenizers run
 * BEFORE the built-in `html` block tokenizer, so this tokenizer claims
 * `<details>` before it can be swallowed as an opaque HTML block. Crucially, the
 * body is recursively lexed with `helper.blockTokens`, so markdown formatting
 * inside a toggle (headings, lists, code, nested toggles) is preserved rather
 * than captured as raw text. `@tiptap/markdown`'s `parse()` drains marked's
 * inline queue after the full block pass, so the deferred inline tokens on those
 * body blocks are populated by the time `parseMarkdown` runs; we also eagerly
 * inline-tokenize the top-level body blocks (matching `@tiptap/core`'s directive
 * spec) for belt-and-suspenders.
 *
 * Round-trip coverage: src/components/editor/toggle-block.test.ts.
 */

/** The marked token type this tokenizer emits and the node's `markdownTokenName`. */
export const TOGGLE_TOKEN = 'toggle'

/** Fallback body markdown for an empty toggle. The patched Paragraph
 *  (paragraph.ts) emits the same sentinel for empty paragraphs, and upstream
 *  Paragraph.parseMarkdown maps it back to an empty paragraph node. */
const EMPTY_BODY_MARKDOWN = '&nbsp;'

// `<details ...>` opening tag, optional trailing newline. `[^>]*` is enough for
// the simple ` open` attribute we emit and tolerant of external variants.
const OPEN_TAG_RE = /^<details\b([^>]*)>[ \t]*\n?/
// `<summary>...</summary>` at the start of the inner content (after leading ws).
const SUMMARY_RE = /^\s*<summary>([\s\S]*?)<\/summary>[ \t]*\n?/
// Any opening or closing <details> tag, for balanced-depth scanning.
const DETAILS_TAG_RE = /<(\/?)details\b[^>]*>/g

/**
 * marked block-level tokenizer for `<details>`. Shaped for
 * `@tiptap/markdown`'s `markdownTokenizer` field, which registers it via
 * `marked.use({ extensions })`.
 */
export const toggleMarkdownTokenizer = {
  name: TOGGLE_TOKEN,
  level: 'block' as const,

  // marked calls `start` with the source minus its first char to locate where
  // the next toggle begins (so the paragraph tokenizer truncates before it).
  // -1 means "no match", matching @tiptap/core's own directive tokenizer.
  start(src: string): number {
    const i = src.indexOf('<details')
    return i < 0 ? -1 : i
  },

  tokenize(src: string, _tokens: unknown, helper: any): any {
    const openMatch = src.match(OPEN_TAG_RE)
    if (!openMatch) return undefined

    const attrs = openMatch[1] || ''
    const isOpen = /\bopen\b/.test(attrs)
    const openLen = openMatch[0].length
    const rest = src.slice(openLen)

    // Find the matching </details>, counting nested toggles so a toggle-in-a-
    // toggle closes at the right tag.
    DETAILS_TAG_RE.lastIndex = 0
    let depth = 1
    let closeStart = -1
    let closeEnd = -1
    let m: RegExpExecArray | null
    while ((m = DETAILS_TAG_RE.exec(rest)) !== null) {
      if (m[1] === '/') {
        depth -= 1
        if (depth === 0) {
          closeStart = m.index
          closeEnd = m.index + m[0].length
          break
        }
      } else {
        depth += 1
      }
    }
    // Unbalanced — let other tokenizers (e.g. the built-in html block) handle it.
    if (closeStart < 0) return undefined

    const inner = rest.slice(0, closeStart)
    const raw = src.slice(0, openLen + closeEnd)

    let summaryInner = ''
    let bodyRaw = inner
    const sm = inner.match(SUMMARY_RE)
    if (sm) {
      summaryInner = sm[1]
      bodyRaw = inner.slice(sm[0].length)
    }

    const summaryTokens = helper.inlineTokens(summaryInner.trim())

    const bodyTrimmed = bodyRaw.replace(/^\n+/, '').replace(/\s+$/, '')
    let bodyTokens: any[] = []
    if (bodyTrimmed) {
      bodyTokens = helper.blockTokens(bodyTrimmed)
      // Eagerly inline-tokenize top-level body blocks. `parse()` also drains the
      // inline queue, but this matches @tiptap/core's directive spec and keeps
      // us correct if the body is ever lexed outside that drain.
      bodyTokens.forEach((token) => {
        if (token && token.text && (!token.tokens || token.tokens.length === 0)) {
          token.tokens = helper.inlineTokens(token.text)
        }
      })
    }

    return {
      type: TOGGLE_TOKEN,
      raw,
      open: isOpen,
      summaryTokens,
      bodyTokens,
      // Keep marked from walking phantom children — our content lives on the
      // custom summary/body keys above.
      tokens: [],
    }
  },
}

/** Build the `toggle` node (summary + content) from a parsed `<details>` token. */
export function parseToggleMarkdown(token: any, helpers: any): any {
  const summary = helpers.parseInline(token.summaryTokens || [])
  let body = (helpers.parseBlockChildren(token.bodyTokens || []) || []).filter(Boolean)
  // toggleContent is `block+` — never let it be empty.
  if (body.length === 0) {
    body = [{ type: 'paragraph' }]
  }

  return {
    type: 'toggle',
    attrs: { open: token.open !== false },
    content: [
      {
        type: 'toggleSummary',
        content: summary && summary.length ? summary : undefined,
      },
      {
        type: 'toggleContent',
        content: body,
      },
    ],
  }
}

/** Serialize a `toggle` node back to `<details>` markdown. */
export function renderToggleMarkdown(node: any, helpers: any): string {
  const children = Array.isArray(node.content) ? node.content : []
  const summaryNode = children.find((n: any) => n.type === 'toggleSummary')
  const contentNode = children.find((n: any) => n.type === 'toggleContent')

  const summaryMd = summaryNode
    ? helpers.renderChildren(summaryNode.content || [])
    : ''
  const bodyMd = contentNode
    ? helpers.renderChildren(contentNode.content || [], '\n\n')
    : ''

  const openAttr = node.attrs && node.attrs.open === false ? '' : ' open'
  const body = bodyMd.trim().length ? bodyMd : EMPTY_BODY_MARKDOWN

  return `<details${openAttr}>\n<summary>${summaryMd}</summary>\n\n${body}\n\n</details>`
}
