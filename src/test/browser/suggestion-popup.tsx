import React, { forwardRef, useImperativeHandle } from 'react';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Suggestion from '@tiptap/suggestion';
import {
  createSuggestionPopupRenderer,
  settledItems,
  type SuggestionPopupRef,
} from '@/components/chat/editor/suggestion/renderer';

declare global {
  interface Window {
    suggestionPopupFixture: { open(query?: string): void; dispose(): void };
  }
}

// A real Suggestion plugin with disposable items. No Home or harness is used.
const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'body';
const slash = params.get('menu') === 'slash';
const host = document.createElement('div');
host.className = `host ${mode}`;
if (mode === 'popover') host.setAttribute('data-radix-popper-content-wrapper', '');
else if (mode !== 'body') host.setAttribute('role', 'dialog');
host.innerHTML = '<div class="scroll"><div class="before"></div><div id="editor"></div><div class="after"></div></div>';
document.body.append(host);

const Menu = forwardRef<SuggestionPopupRef, { items: string[]; command: (item: string) => void }>(
  function Menu({ items, command }, ref) {
    useImperativeHandle(ref, () => ({ onKeyDown: ({ event }) => {
      if (event.key !== 'Enter') return false;
      command(items[0]);
      return true;
    } }));
    return <div className="menu">{items.map(item => <button key={item}
      onMouseDown={event => event.preventDefault()}
      onClick={() => command(item)}>{item}</button>)}</div>;
  },
);

const editor = new Editor({
  element: document.querySelector('#editor')!,
  extensions: [StarterKit, Extension.create({
    name: 'fixtureSuggestions',
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor,
        char: slash ? '/' : '@',
        items: async ({ query }) => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return settledItems(Array.from({ length: query === 'large' ? 15 : 4 }, (_, i) => `Result ${i + 1}`));
        },
        command: ({ editor, range, props }) => editor.chain().focus().deleteRange(range).insertContent(props).run(),
        render: createSuggestionPopupRenderer(Menu, {
          asyncItems: true,
          ...(slash ? { placement: 'bottom-start' as const, matchEditorWidth: false, gap: 4 } : {}),
        }),
      })];
    },
  })],
});

Object.assign(window, {
  suggestionPopupFixture: {
    open(query = '') {
      editor.commands.setContent('<p></p>');
      editor.commands.focus('end');
      editor.commands.insertContent(`${slash ? '/' : '@'}${query}`);
    },
    dispose: () => editor.destroy(),
  },
});
