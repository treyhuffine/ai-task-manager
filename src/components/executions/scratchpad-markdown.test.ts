import { describe, expect, it } from 'vitest'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'

/**
 * Pins the scratchpad body round-trip (see scratchpad-pane.tsx).
 *
 * The pane persists `editor.getMarkdown()` and reloads it with
 * `editor.markdown.parse(...)`. Before that fix it saved `editor.getText()`
 * (plain text) and reloaded the bare string via `setContent(string)`, which
 * Tiptap parses as HTML — HTML collapses newline whitespace, so a multi-line
 * scratchpad came back as one block on the next mount. These tests build a
 * MarkdownManager over the pane's exact extension set and prove multi-line
 * structure survives serialize → parse, and that legacy plain-text bodies
 * (the old getText() output) still open as separate paragraphs.
 */
function buildScratchpadManager() {
  // Mirror ScratchpadEditor's StarterKit config. Placeholder doesn't affect
  // serialization, and Markdown IS this manager, so StarterKit is all that
  // shapes the markdown round-trip.
  return new MarkdownManager({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        horizontalRule: false,
      }),
    ],
  })
}

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
})

describe('scratchpad markdown round-trip', () => {
  it('keeps each line a separate paragraph across serialize → parse', () => {
    const mgr = buildScratchpadManager()
    const doc = {
      type: 'doc',
      content: [paragraph('line one'), paragraph('line two'), paragraph('line three')],
    }

    // What getMarkdown() would persist.
    const stored = mgr.serialize(doc)
    // Newlines survive in storage — not one collapsed run.
    expect(stored).toBe('line one\n\nline two\n\nline three')

    // What markdown.parse() reconstructs on the next mount.
    const blocks = (mgr.parse(stored).content ?? []) as Array<{
      type: string
      content?: Array<{ text?: string }>
    }>
    expect(blocks).toHaveLength(3)
    expect(blocks.every((b) => b.type === 'paragraph')).toBe(true)
    expect(blocks.map((b) => b.content?.[0]?.text)).toEqual([
      'line one',
      'line two',
      'line three',
    ])
  })

  it('preserves a blank line between paragraphs (Enter, Enter)', () => {
    const mgr = buildScratchpadManager()
    const doc = {
      type: 'doc',
      content: [paragraph('before the gap'), paragraph(''), paragraph('after the gap')],
    }
    const blocks = (mgr.parse(mgr.serialize(doc)).content ?? []) as Array<{
      content?: unknown[]
    }>
    expect(blocks).toHaveLength(3)
    expect(blocks[1].content ?? []).toHaveLength(0)
  })

  it('opens a legacy plain-text body (old getText output) as separate paragraphs', () => {
    // Bodies saved before the fix are plain text whose paragraphs are joined
    // by "\n\n" (getText's default block separator). Parsed as markdown they
    // split back into paragraphs rather than collapsing into one block.
    const mgr = buildScratchpadManager()
    const legacy = 'first thought\n\nsecond thought\n\nthird thought'
    const blocks = (mgr.parse(legacy).content ?? []) as Array<{
      content?: Array<{ text?: string }>
    }>
    expect(blocks).toHaveLength(3)
    expect(blocks.map((b) => b.content?.[0]?.text)).toEqual([
      'first thought',
      'second thought',
      'third thought',
    ])
  })

  it('is a fixed point under a second round-trip', () => {
    const mgr = buildScratchpadManager()
    const doc = {
      type: 'doc',
      content: [
        paragraph('todo:'),
        paragraph('- wire up the thing'),
        paragraph(''),
        paragraph('question for later'),
      ],
    }
    const once = mgr.serialize(mgr.parse(mgr.serialize(doc)))
    const twice = mgr.serialize(mgr.parse(once))
    expect(twice).toBe(once)
  })

  it('serializes an empty document to an empty string (drives the null-save + has-content dot)', () => {
    const mgr = buildScratchpadManager()
    const empty = { type: 'doc', content: [paragraph('')] }
    expect(mgr.serialize(empty)).toBe('')
  })
})
