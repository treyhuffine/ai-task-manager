import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { Editor } from '@tiptap/core';
import { FileChipNode } from './file-chip-node';
import { AppSnippetNode, snippetPreview } from './app-snippet-node';
import { appPartsContent, buildMarkerOutput, buildUiMessageParts } from './chat-input-editor';
import type { AppDraftPart } from '@/lib/client/app-chat-intent';

/**
 * A connected app's draft in the composer (OpenAI's `ui/message` with
 * `send: false`): text, titled items and files go in as the editor's own
 * nodes, and what the person sends reads as the app wrote it.
 */
const schema = getSchema([StarterKit, FileChipNode, AppSnippetNode]);
const attachment = { fileName: '01900000-0000-7000-8000-000000000001.png', originalName: 'Front view.png', mimeType: 'image/png', size: 68, uploadedAt: '2026-10-19T00:00:00.000Z' };
const parts: AppDraftPart[] = [
  { type: 'text', text: 'Help me design a bracket.\nIt holds a motor.' },
  { type: 'snippet', title: 'Agent dial', text: 'Selected: agent dial' },
  { type: 'file', attachment },
];
const editorOf = (content: Record<string, unknown>[]) => ({ state: { doc: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content }] }) } }) as unknown as Pick<Editor, 'state'>;

describe('an app\'s draft in the composer', () => {
  it('becomes text with its line breaks, a titled item and a file chip', () => {
    expect(appPartsContent(parts)).toEqual([
      { type: 'text', text: 'Help me design a bracket.' }, { type: 'hardBreak' }, { type: 'text', text: 'It holds a motor.' },
      { type: 'text', text: ' ' },
      { type: 'appSnippet', attrs: { title: 'Agent dial', text: 'Selected: agent dial' } },
      { type: 'text', text: ' ' },
      { type: 'fileChip', attrs: { ...attachment, pending: false, pendingId: '' } },
    ]);
    expect(appPartsContent([])).toEqual([]);
  });

  it('sends the titled item as its text and the file as its marker, in both output formats', () => {
    const editor = editorOf(appPartsContent(parts));
    expect(buildMarkerOutput(editor)).toEqual({
      text: `Help me design a bracket.\nIt holds a motor. Selected: agent dial [[file:${attachment.fileName}]]`,
      attachments: [attachment],
    });
    expect(buildUiMessageParts(editor).parts).toEqual([
      { type: 'text', text: 'Help me design a bracket.\nIt holds a motor. Selected: agent dial ' },
      { type: 'file', mediaType: 'image/png', filename: 'Front view.png', url: expect.stringContaining(attachment.fileName) },
    ]);
  });

  it('previews a long item\'s text on one line for its tooltip', () => {
    expect(snippetPreview('Line one\n\n  line two')).toBe('Line one line two');
    expect(snippetPreview('x'.repeat(300))).toHaveLength(240);
  });
});
