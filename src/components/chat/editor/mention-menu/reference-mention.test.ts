import { describe, expect, it } from 'vitest';
import { closeHistory, history, redo, undo } from '@tiptap/pm/history';
import { Schema } from '@tiptap/pm/model';
import { EditorState, NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { createReferenceMentionPlugin } from './reference-mention';
import { toReferenceMention } from './ranking';
import type { ReferenceFolderMentionItem } from './types';

const schema = new Schema({ nodes: {
  doc: { content: 'paragraph+' },
  paragraph: { content: 'inline*', group: 'block' },
  text: { group: 'inline' },
  mentionChip: { inline: true, group: 'inline', atom: true, attrs: {
    kind: {}, path: {}, name: {}, label: { default: null }, referenceAlias: { default: null },
  } },
} });

const agentex: ReferenceFolderMentionItem = {
  kind: 'reference', id: 'ref-1', alias: 'agentex', absolutePath: '/code/agentex', exists: true,
};

function fixture(references = [agentex], isComposing = () => false) {
  const plugin = createReferenceMentionPlugin(() => references, isComposing);
  let state = EditorState.create({ schema, plugins: [plugin, history()] });
  const dispatch = (tr: typeof state.tr) => { state = state.applyTransaction(tr).state; };
  const view = { get state() { return state; }, dispatch, composing: false } as EditorView;
  return {
    get state() { return state; },
    get first() { return state.doc.firstChild!.firstChild; },
    dispatch,
    type: (text: string) => { for (const char of text) dispatch(state.tr.insertText(char)); },
    insert: (text: string) => dispatch(state.tr.insertText(text)),
    select: (reference = references[0]) => dispatch(closeHistory(state.tr.replaceWith(
      1, state.selection.to, schema.nodes.mentionChip.create(toReferenceMention(reference)),
    ))),
    backspace: () => plugin.props.handleKeyDown!.call(plugin, view, { key: 'Backspace' } as KeyboardEvent),
    undo: () => undo(state, dispatch),
    redo: () => redo(state, dispatch),
  };
}

describe('selected linked-folder mentions', () => {
  it('keeps even a full exact repo name as text until selected', () => {
    const f = fixture();
    f.type('@agentex');
    expect(f.first!.isText).toBe(true);
    expect(f.state.doc.textContent).toBe('@agentex');
    f.select();
    expect(f.first!.type.name).toBe('mentionChip');
    expect(f.first!.attrs).toMatchObject({ kind: 'dir', path: '/code/agentex', label: 'agentex' });
  });

  it('keeps longer aliases and pasted names as text until selected', () => {
    const references = [agentex, { ...agentex, id: 'ref-2', alias: 'agentex-tools', absolutePath: '/code/tools' }];
    for (const text of ['@agentex-tools', '@agentex.docs', '@AgEnTeX', '@agentex', '@agentex/src/index.ts']) {
      const f = fixture(references);
      f.insert(text);
      expect(f.first!.isText).toBe(true);
      expect(f.state.doc.textContent).toBe(text);
    }
  });

  it('leaves the selected mention in place while continuing a message', () => {
    const f = fixture();
    f.select();
    f.type(' and find the tests');
    expect(f.first!.attrs.path).toBe('/code/agentex');
    expect(f.state.doc.textContent).toBe(' and find the tests');
  });

  it('keeps ordinary typing and punctuation after a selected mention', () => {
    const f = fixture();
    f.select();
    f.type('please, find this.');
    expect(f.first!.type.name).toBe('mentionChip');
    expect(f.state.doc.textContent).toBe('please, find this.');
  });

  it('opens a file query only when a slash immediately follows the chip', () => {
    const f = fixture();
    f.select();
    f.type('/src/index.ts');
    expect(f.first!.isText).toBe(true);
    expect(f.state.doc.textContent).toBe('@agentex/src/index.ts');
  });

  it('supports pasted slash refinements after a selected mention', () => {
    const f = fixture();
    f.select();
    f.insert('/src/index.ts');
    expect(f.state.doc.textContent).toBe('@agentex/src/index.ts');
  });

  it('keeps a slash typed later in the message as ordinary text', () => {
    const f = fixture();
    f.select();
    f.type(' /src/index.ts');
    expect(f.first!.type.name).toBe('mentionChip');
    expect(f.state.doc.textContent).toBe(' /src/index.ts');
  });

  it('leaves folders on another device selected without browsing them', () => {
    const f = fixture([{ ...agentex, browsable: false }]);
    f.select();
    f.type('/');
    expect(f.first!.type.name).toBe('mentionChip');
    expect(f.state.doc.textContent).toBe('/');
  });

  it('does not rewrite input during IME composition', () => {
    let composing = true;
    const f = fixture([agentex], () => composing);
    f.select();
    f.type('/');
    expect(f.first!.type.name).toBe('mentionChip');
    composing = false;
    f.dispatch(f.state.tr.insertText('/', 2, 3));
    expect(f.state.doc.textContent).toBe('@agentex/');
  });

  it('restores the selected name on Backspace so it can be edited', () => {
    const f = fixture();
    f.select();
    expect(f.backspace()).toBe(true);
    expect(f.state.doc.textContent).toBe('@agentex');
    f.type('-other');
    expect(f.state.doc.textContent).toBe('@agentex-other');
  });

  it('restores a node-selected folder chip on Backspace too', () => {
    const f = fixture();
    f.select();
    f.dispatch(f.state.tr.setSelection(NodeSelection.create(f.state.doc, 1)));
    expect(f.backspace()).toBe(true);
    expect(f.state.doc.textContent).toBe('@agentex');
  });

  it('does not swallow Backspace in ordinary text', () => {
    const f = fixture();
    f.type('normal text');
    expect(f.backspace()).toBe(false);
  });

  it('undoes selection back to text without automatically reselecting it', () => {
    const f = fixture();
    f.type('@agentex');
    f.select();
    expect(f.undo()).toBe(true);
    expect(f.state.doc.textContent).toBe('@agentex');
    expect(f.first!.isText).toBe(true);
    expect(f.redo()).toBe(true);
    expect(f.first!.attrs.path).toBe('/code/agentex');
  });
});
