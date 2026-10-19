import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { MentionMenuExtension } from '@/components/chat/editor/mention-menu/extension';
import { MentionChipNode } from '@/components/chat/editor/mention-menu/mention-chip-node';
import type { ReferenceFolderMentionItem } from '@/components/chat/editor/mention-menu/types';

declare global {
  interface Window {
    referenceMentionFixture: {
      reset(): void;
      json(): JSONContent;
      output(): string;
      insert(text: string): void;
      treeLoads(): number;
      submitted(): string[];
      settleSearches(): Promise<unknown>;
    };
  }
}

const references: ReferenceFolderMentionItem[] = [
  { kind: 'reference', id: 'r1', alias: 'agentex', absolutePath: '/code/agentex', exists: true },
  { kind: 'reference', id: 'r2', alias: 'agentex-tools', absolutePath: '/code/tools', exists: true },
  { kind: 'reference', id: 'r3', alias: 'agentex.docs', absolutePath: '/code/docs', exists: true },
  { kind: 'reference', id: 'r4', alias: 'remote', absolutePath: '/other/remote', exists: true, browsable: false },
];
let treeLoads = 0;
const submitted: string[] = [];
const pendingSearches: Promise<void>[] = [];

function output(editor: Editor) {
  let text = '';
  editor.state.doc.descendants(node => {
    if (node.type.name === 'mentionChip') { text += `@${node.attrs.path}`; return false; }
    if (node.isText) text += node.text;
  });
  return text;
}

function Fixture() {
  const editor = useEditor({ immediatelyRender: false, extensions: [
    StarterKit,
    MentionChipNode,
    MentionMenuExtension.configure({
      getReferenceFolders: () => references,
      getFileEntries: () => [{ kind: 'file', name: 'local.txt', path: 'local.txt' }],
      searchEntities: async () => {
        const pending = new Promise<void>(resolve => setTimeout(resolve, 80));
        pendingSearches.push(pending);
        await pending;
        return { tasks: [], notes: [], totals: { tasks: 0, notes: 0 } };
      },
      loadReferenceTree: async () => {
        treeLoads++;
        await new Promise(resolve => setTimeout(resolve, 25));
        return [{ kind: 'file', name: 'index.ts', path: 'src/index.ts' }];
      },
    }),
    Extension.create({ name: 'fixtureSubmit', priority: 150, addKeyboardShortcuts() {
      return { Enter: () => { submitted.push(output(this.editor)); return true; } };
    } }),
  ] });

  useEffect(() => {
    if (!editor) return;
    window.referenceMentionFixture = {
      reset() {
        editor.commands.clearContent();
        editor.commands.focus('end');
        treeLoads = 0;
        submitted.length = 0;
      },
      json: () => editor.getJSON(),
      output: () => output(editor),
      insert: text => { editor.commands.insertContent(text); },
      treeLoads: () => treeLoads,
      submitted: () => submitted,
      settleSearches: () => Promise.all(pendingSearches),
    };
  }, [editor]);

  return <main><p className="caption">Message</p><div className="composer"><EditorContent editor={editor} /></div><button>Outside editor</button></main>;
}

createRoot(document.body.appendChild(document.createElement('div'))).render(<Fixture />);
