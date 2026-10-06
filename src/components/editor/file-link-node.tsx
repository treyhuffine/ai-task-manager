/**
 * `[[file:<name>]]` in a note or task body, shown as the file instead of the
 * marker text: an image inline (click opens it full size in a new tab), any
 * other file as a chip that downloads it. Serializes back to the same marker,
 * so the body stays plain markdown and round-trips through save and load like
 * the entity links next to it (`entity-link-node.tsx`).
 *
 * The file is served from the home's attachments folder
 * (`GET /api/attachments/:fileName`), the same place chat attachments live.
 */
import { Node, mergeAttributes, type NodeViewProps, type MarkdownToken, type JSONContent } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { Download, ImageOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { attachmentUrl } from '@/lib/attachments/view';
import { resolveMime } from '@/lib/attachments/mime';
import { FILE_LINK_RE, renderFileLinkMarkdown } from './file-link-marker';
import { Tip } from '@/components/ui/tip';

export const FILE_LINK_NAME = 'fileLink';

export const FileLinkNode = Node.create({
  name: FILE_LINK_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { fileName: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'span[data-file-link]', getAttrs: (el) => ({ fileName: (el as HTMLElement).dataset.fileName ?? '' }) }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-file-link': 'true', 'data-file-name': node.attrs.fileName })];
  },

  markdownTokenizer: {
    name: FILE_LINK_NAME,
    level: 'inline',
    start: (src: string) => src.indexOf('[[file:'),
    tokenize: (src: string): MarkdownToken | undefined => {
      const m = FILE_LINK_RE.exec(src);
      if (!m) return undefined;
      return { type: FILE_LINK_NAME, raw: m[0], fileName: m[1] } as unknown as MarkdownToken;
    },
  },
  parseMarkdown: (token: MarkdownToken): JSONContent => ({
    type: FILE_LINK_NAME,
    attrs: { fileName: (token as MarkdownToken & { fileName: string }).fileName },
  }),
  renderMarkdown: (node: JSONContent): string => renderFileLinkMarkdown(node.attrs?.fileName ?? ''),

  addNodeView() {
    return ReactNodeViewRenderer(FileLinkView);
  },
});

function FileLinkView({ node, selected }: NodeViewProps) {
  const fileName = (node.attrs.fileName as string) ?? '';
  const url = attachmentUrl(fileName);
  const isImage = resolveMime(null, fileName).startsWith('image/');
  const [broken, setBroken] = useState(false);

  if (isImage && !broken) {
    return (
      <NodeViewWrapper
        as="span"
        contentEditable={false}
        data-drag-handle="false"
        className={cn('inline-block max-w-full align-middle my-1', selected && 'ring-2 ring-primary/40 rounded-lg')}
      >
        <Tip label={`${fileName} (opens full size)`}>
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${fileName} (opens full size)`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={fileName}
              onError={() => setBroken(true)}
              className="block max-h-96 max-w-full rounded-lg border border-border"
            />
          </a>
        </Tip>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-drag-handle="false"
      className={cn(
        'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5',
        'rounded-md border border-border bg-muted/40 text-foreground text-[12px] font-medium',
        'hover:border-foreground/30 hover:bg-muted/60 transition-colors select-none',
        selected && 'ring-2 ring-primary/40 border-primary/40',
      )}
    >
      <Tip label={broken ? `${fileName} isn't in the attachments folder` : `Download ${fileName}`}>
        <a href={url} download={fileName} className="inline-flex items-center gap-1 text-foreground! no-underline!">
          {broken ? <ImageOff size={11} className="shrink-0 text-muted-foreground/80" /> : <Download size={11} className="shrink-0 text-muted-foreground/80" />}
          <span className="font-mono text-[11px] truncate max-w-[240px]">{fileName}</span>
        </a>
      </Tip>
    </NodeViewWrapper>
  );
}
