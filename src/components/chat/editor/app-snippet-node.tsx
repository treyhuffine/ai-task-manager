/**
 * A titled item an app put in the composer (OpenAI's `ui/message` titles,
 * docs/connected-mcp-apps.md "Messages"). It shows its title as a chip, is
 * removed as one unit, and sends as its text: the person sees "Agent dial",
 * the agent reads "Selected: agent dial".
 *
 * Inserted by the composer's app channel (`app-chat-intent.ts`), never typed.
 */
import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { AppWindow, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';

export const APP_SNIPPET_NAME = 'appSnippet';

export interface AppSnippetAttrs {
  /** What the person sees. */
  title: string;
  /** What the message carries. */
  text: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    appSnippet: {
      /** Insert a titled app item at the cursor. */
      insertAppSnippet: (attrs: AppSnippetAttrs) => ReturnType;
    };
  }
}

export const AppSnippetNode = Node.create({
  name: APP_SNIPPET_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: { default: '' },
      text: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-app-snippet]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-app-snippet': 'true' })];
  },

  addCommands() {
    return {
      insertAppSnippet:
        (attrs: AppSnippetAttrs) =>
        ({ commands }) =>
          commands.insertContent({ type: APP_SNIPPET_NAME, attrs }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(AppSnippetView);
  },
});

/** A snippet's preview: its text, shortened for a tooltip. */
export function snippetPreview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 240 ? `${flat.slice(0, 239)}…` : flat;
}

function AppSnippetView({ node, editor, getPos, selected }: NodeViewProps) {
  const attrs = node.attrs as AppSnippetAttrs;
  const remove = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  };
  return (
    <Tip label={snippetPreview(attrs.text)}>
      <NodeViewWrapper
        as="span"
        contentEditable={false}
        data-drag-handle="false"
        className={cn(
          'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5',
          'rounded-md border bg-muted/40 text-foreground text-[12px] font-medium',
          'border-border hover:border-foreground/30 transition-colors',
          'cursor-default select-none',
          selected && 'ring-2 ring-primary/40 border-primary/40',
        )}
      >
        <AppWindow size={11} className="shrink-0 text-muted-foreground/80" aria-hidden />
        <span className="max-w-[200px] truncate text-[11px]">{attrs.title}</span>
        <button
          type="button"
          onMouseDown={remove}
          className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Remove ${attrs.title}`}
          tabIndex={-1}
        >
          <X size={10} />
        </button>
      </NodeViewWrapper>
    </Tip>
  );
}
