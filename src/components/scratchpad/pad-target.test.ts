import { describe, expect, it } from 'vitest';
import { Node, getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TaskItem } from '@/components/editor/task-item';
import { padTarget, replaceChanged, targetStillThere, titleAndBody } from './pad-target';

/** What the scratchpad's actions move (docs/scratchpad.md, "Moving a line out"). */

// The entity chip's shape, without its React view.
const EntityLink = Node.create({ name: 'entityLink', group: 'inline', inline: true, atom: true, addAttributes: () => ({ kind: { default: 'task' }, id: { default: '' } }) });
const extensions = [StarterKit, TaskList, TaskItem.configure({ nested: true }), EntityLink];
const schema = getSchema(extensions);
const markdown = new MarkdownManager({ extensions });

function find(doc: PMNode, needle: string): number {
  let at = -1;
  doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text?.includes(needle)) at = pos + node.text.indexOf(needle);
  });
  if (at === -1) throw new Error(`no ${needle}`);
  return at;
}

function caretIn(md: string, needle: string) {
  const doc = schema.nodeFromJSON(markdown.parse(md));
  return EditorState.create({ doc, selection: TextSelection.create(doc, find(doc, needle)) });
}

function selecting(md: string, start: string, end: string) {
  const doc = schema.nodeFromJSON(markdown.parse(md));
  return EditorState.create({ doc, selection: TextSelection.create(doc, find(doc, start), find(doc, end) + end.length) });
}

function afterRemoving(state: EditorState) {
  const target = padTarget(state)!;
  return markdown.serialize(state.apply(state.tr.delete(target.removeFrom, target.removeTo)).doc.toJSON()).trim();
}

describe('padTarget', () => {
  it('takes the line the caret is on when nothing is selected', () => {
    const state = caretIn('First\n\nCall the insurer\n\nLast', 'insurer');
    expect(padTarget(state)).toMatchObject({ kind: 'line', text: 'Call the insurer' });
    expect(afterRemoving(state)).toBe('First\n\nLast');
  });

  it('takes the selection when there is one', () => {
    const state = selecting('Call the insurer about the claim', 'insurer', 'claim');
    expect(padTarget(state)).toMatchObject({ kind: 'selection', text: 'insurer about the claim' });
    expect(afterRemoving(state)).toBe('Call the');
  });

  it('keeps a selection across lines as lines', () => {
    expect(padTarget(selecting('One\n\nTwo\n\nThree', 'One', 'Two'))?.text).toBe('One\nTwo');
  });

  it('takes a checklist line without its box, and clears its whole item', () => {
    const state = caretIn('- [ ] Backfill GEX\n- [ ] Pick a better voice', 'voice');
    expect(padTarget(state)).toMatchObject({ kind: 'line', text: 'Pick a better voice' });
    expect(afterRemoving(state)).toBe('- [ ] Backfill GEX');
  });

  it('clears a list it would leave empty', () => {
    expect(afterRemoving(caretIn('Before\n\n- only item\n\nAfter', 'only'))).toBe('Before\n\nAfter');
  });

  it('leaves the pad empty, not broken, when its one line goes', () => {
    expect(afterRemoving(caretIn('Just this', 'this'))).toBe('');
  });

  it('has nothing to move on an empty line', () => {
    const doc = schema.nodeFromJSON(markdown.parse('Text'));
    const empty = EditorState.create({ doc: schema.node('doc', null, [schema.node('paragraph'), ...doc.content.content]) });
    expect(padTarget(empty)).toBeNull();
  });

  it('moves a chip in the line as its marker', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [
      schema.text('Follow up '), schema.nodes.entityLink.create({ kind: 'task', id: 'abc' }), schema.text(' today'),
    ])]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, find(doc, 'today')) });
    expect(padTarget(state)?.text).toBe('Follow up [[task:abc]] today');
  });
});

describe('targetStillThere', () => {
  it('notices the text changed while a task was made', () => {
    const state = caretIn('Call the insurer', 'insurer');
    const target = padTarget(state)!;
    expect(targetStillThere(state, target)).toBe(true);
    const edited = state.apply(state.tr.insertText('X', target.from));
    expect(targetStillThere(edited, target)).toBe(false);
  });
});

describe('titleAndBody', () => {
  it('titles a task with its first line and keeps the rest as its body', () => {
    expect(titleAndBody('Call the insurer\nclaim 4471\nask about the deadline')).toEqual({ title: 'Call the insurer', body: 'claim 4471\nask about the deadline' });
    expect(titleAndBody('One line')).toEqual({ title: 'One line', body: '' });
    expect(titleAndBody('x'.repeat(300)).title).toHaveLength(200);
  });
});

describe('replaceChanged', () => {
  const parse = (md: string) => schema.nodeFromJSON(markdown.parse(md));
  const blocks = (doc: PMNode) => { const out: string[] = []; doc.forEach(n => out.push(n.textContent)); return out; };
  const caretBlock = (state: EditorState) => state.selection.$from.index(0);

  it("keeps the caret on the new empty line when another device's line arrives above it", () => {
    const doc = parse('Team\n\n');
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, doc.content.size - 1) });
    expect(blocks(doc)).toEqual(['Team', '']);
    const next = state.apply(replaceChanged(state, parse('Team\n\nPhone\n\n'))!);
    expect(blocks(next.doc)).toEqual(['Team', 'Phone', '']);
    expect(caretBlock(next)).toBe(2);
  });

  it('leaves the caret where it is when the change is elsewhere', () => {
    const state = caretIn('One\n\nTwo\n\nThree', 'Two');
    const at = state.selection.from;
    const next = state.apply(replaceChanged(state, parse('One\n\nTwo\n\nThree\n\nFour'))!);
    expect(next.selection.from).toBe(at);
    expect(blocks(next.doc)).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('moves the caret along with lines added above it', () => {
    const state = caretIn('One\n\nTwo', 'Two');
    const next = state.apply(replaceChanged(state, parse('Zero\n\nOne\n\nTwo'))!);
    expect(next.doc.textBetween(next.selection.from, next.selection.from + 3)).toBe('Two');
  });

  it('does nothing when the text is the same', () => {
    expect(replaceChanged(caretIn('Same', 'Same'), parse('Same'))).toBeNull();
  });
});
