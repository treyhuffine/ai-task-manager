import { describe, expect, it } from 'vitest'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import type { JSONContent } from '@tiptap/core'
import { EntityLinkNode } from './entity-link-node'
import { FileLinkNode, FILE_LINK_NAME } from './file-link-node'
import { FILE_LINK_RE } from './file-link-marker'

const markdown = new MarkdownManager({ extensions: [StarterKit, EntityLinkNode, FileLinkNode] })

function inline(json: JSONContent): JSONContent[] {
  return json.content?.[0]?.content ?? []
}

describe('file link in a note or task body', () => {
  it('reads [[file:name]] as a file node and writes the same marker back', () => {
    const md = 'Toolbar, full width: [[file:ballcoach-toolbar-full.png]] and half [[file:01a10c91-1087.png]]'
    const json = markdown.parse(md)
    const files = inline(json).filter((n) => n.type === FILE_LINK_NAME).map((n) => n.attrs?.fileName)
    expect(files).toEqual(['ballcoach-toolbar-full.png', '01a10c91-1087.png'])
    expect(markdown.serialize(json).trim()).toBe(md)
  })

  it('sits beside entity links without either taking the other', () => {
    const md = 'See [[task:0192abcd-1234]] and [[file:spec.pdf]]'
    const json = markdown.parse(md)
    expect(inline(json).map((n) => n.type)).toEqual(['text', 'entityLink', 'text', FILE_LINK_NAME])
    expect(markdown.serialize(json).trim()).toBe(md)
  })

  it('leaves anything that is not a bare file name as text', () => {
    for (const md of ['[[file:...]]', '[[file:<fileName>]]', '[[file:../etc/passwd]]', '[[file:a/b.png]]', '[[file:noext]]']) {
      expect(FILE_LINK_RE.exec(md)).toBeNull()
      expect(inline(markdown.parse(md)).some((n) => n.type === FILE_LINK_NAME)).toBe(false)
    }
  })
})
