import { Node, mergeAttributes, nodePasteRule, type NodeViewProps } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { SourceChip } from '../source-chip';
import { sourceMarker, decodeSource } from '@/lib/chat-sources/reference';
import { handleChipBackspace } from './suggestion/chip-backspace';
export const SOURCE_CHIP_NAME = 'sourceChip';
export interface SourceChipAttrs { sourceRef: string }
declare module '@tiptap/core' {
  interface Commands<ReturnType> { sourceChip: { insertSourceChip: (attrs: SourceChipAttrs) => ReturnType } }
}
export const SourceChipNode = Node.create({
  name: SOURCE_CHIP_NAME, group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes: () => ({ sourceRef: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-source-chip]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-source-chip': 'true' })],
  renderText: ({ node }) => sourceMarker(node.attrs.sourceRef),
  addPasteRules() { return [nodePasteRule({ find: /\[\[source:([A-Za-z0-9_-]+)\]\]/g, type: this.type, getAttributes: match => { try { decodeSource(match[1]); return { sourceRef: match[1] }; } catch { return false; } } })]; },
  addCommands() { return { insertSourceChip: attrs => ({ commands }) => commands.insertContent({ type: SOURCE_CHIP_NAME, attrs }) }; },
  addKeyboardShortcuts() { return { Backspace: ({ editor }) => handleChipBackspace(editor, SOURCE_CHIP_NAME, '@app:') }; },
  addNodeView: () => ReactNodeViewRenderer(SourceChipView),
});
function SourceChipView({ node, deleteNode }: NodeViewProps) {
  return <NodeViewWrapper as="span" className="inline"><SourceChip sourceRef={node.attrs.sourceRef} onRemove={deleteNode} /></NodeViewWrapper>;
}
