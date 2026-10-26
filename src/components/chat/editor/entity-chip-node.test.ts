import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { Editor } from '@tiptap/core';
import { EntityChipNode } from './entity-chip-node';
import { buildMarkerOutput, buildUiMessageParts } from './chat-input-editor';

/**
 * An `@agent` chip sends as its `[[agent:id]]` marker, in place, the way
 * task and note chips send theirs. The server expands it for the agent.
 */
const schema = getSchema([StarterKit, EntityChipNode]);
const editorOf = (content: Record<string, unknown>[]) =>
  ({ state: { doc: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content }] }) } }) as unknown as Pick<Editor, 'state'>;

describe('an agent chip in the composer', () => {
  const editor = editorOf([
    { type: 'text', text: 'Ask ' },
    { type: 'entityChip', attrs: { kind: 'agent', id: 'ws-ri', title: 'Ri' } },
    { type: 'text', text: ' about ' },
    { type: 'entityChip', attrs: { kind: 'task', id: 't1', title: 'Fix deploy', status: 'todo' } },
  ]);

  it('sends as its marker beside a task marker', () => {
    expect(buildMarkerOutput(editor)).toEqual({ text: 'Ask [[agent:ws-ri]] about [[task:t1]]', attachments: [] });
  });

  it('keeps the same marker in the message parts', () => {
    expect(buildUiMessageParts(editor).parts).toEqual([{ type: 'text', text: 'Ask [[agent:ws-ri]] about [[task:t1]]' }]);
  });

  it('sends nothing for a chip that lost its id', () => {
    expect(buildMarkerOutput(editorOf([{ type: 'entityChip', attrs: { kind: 'agent', id: '', title: 'Ri' } }])).text).toBe('');
  });
});
