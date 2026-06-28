import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { FileChipNode, FILE_CHIP_NAME, type FileChipAttrs } from './file-chip-node';
import { hasPendingFileChip, type ProseMirrorJSONNode } from './pending-uploads';

/**
 * Lifecycle test for the send-while-uploading block.
 *
 * The pure `pending-uploads.test.ts` checks the detector against
 * hand-authored JSON. This file closes the gap the unit test can't reach
 * without a DOM: it drives the *real* `FileChipNode` schema through the
 * exact ProseMirror transactions the editor performs in production —
 *   - `insertFileChip(...)`        → insert (placeholder appears)
 *   - `replacePendingChip(...)`    → setNodeMarkup (upload resolves)
 *   - `removePendingChip(...)`     → delete (upload fails)
 * — and asserts two things per step:
 *
 *   1. `tr.docChanged` is true. Tiptap emits its `update` event (which is
 *      where `onPendingUploadsChange` fires) only on doc-changing
 *      transactions, so this is what guarantees the composer is notified.
 *   2. `hasPendingFileChip(state.doc.toJSON())` reports the right value.
 *      Using real `toJSON()` output also proves `pending` actually
 *      serializes — the assumption the whole approach rests on.
 *
 * Built headless via `getSchema` (no editor view / DOM needed), so it runs
 * in the project's node-only vitest setup.
 */

const schema = getSchema([StarterKit, FileChipNode]);

/** Mirrors `insertFileChip`: a fileChip atom inserted at `pos`. */
function insertChip(state: EditorState, pos: number, attrs: Partial<FileChipAttrs>): EditorState {
  const node = schema.nodes[FILE_CHIP_NAME].create(attrs);
  const tr = state.tr.insert(pos, node);
  expect(tr.docChanged).toBe(true);
  return state.apply(tr);
}

/** Locate a chip by its `pendingId`, exactly like `findPendingChip`. */
function findChip(state: EditorState, pendingId: string): { pos: number; node: PMNode } | null {
  let hit: { pos: number; node: PMNode } | null = null;
  state.doc.descendants((node, pos) => {
    if (hit) return false;
    if (node.type.name === FILE_CHIP_NAME && (node.attrs as FileChipAttrs).pendingId === pendingId) {
      hit = { pos, node };
      return false;
    }
    return true;
  });
  return hit;
}

/** Mirrors `replacePendingChip`: swap pending attrs for the resolved attachment. */
function resolveChip(state: EditorState, pendingId: string, fileName: string): EditorState {
  const hit = findChip(state, pendingId);
  if (!hit) throw new Error(`no pending chip ${pendingId}`);
  const tr = state.tr.setNodeMarkup(hit.pos, undefined, {
    fileName,
    originalName: 'shot.png',
    mimeType: 'image/png',
    size: 1234,
    uploadedAt: '2026-06-28T00:00:00.000Z',
    pending: false,
    pendingId: '',
  } as FileChipAttrs);
  expect(tr.docChanged).toBe(true);
  return state.apply(tr);
}

/** Mirrors `removePendingChip`: delete the placeholder on upload failure. */
function removeChip(state: EditorState, pendingId: string): EditorState {
  const hit = findChip(state, pendingId);
  if (!hit) throw new Error(`no pending chip ${pendingId}`);
  const tr = state.tr.delete(hit.pos, hit.pos + hit.node.nodeSize);
  expect(tr.docChanged).toBe(true);
  return state.apply(tr);
}

const pending = (id: string): Partial<FileChipAttrs> => ({
  fileName: '',
  originalName: 'shot.png',
  mimeType: 'image/png',
  pending: true,
  pendingId: id,
});

function isPending(state: EditorState): boolean {
  return hasPendingFileChip(state.doc.toJSON() as ProseMirrorJSONNode, FILE_CHIP_NAME);
}

describe('pending-upload lifecycle (real FileChipNode schema)', () => {
  it('the pending attr round-trips through getJSON serialization', () => {
    // The composer reads `editor.getJSON()`; if `pending` didn't serialize,
    // the gate would never trigger. Lock that contract.
    const state = insertChip(EditorState.create({ schema }), 1, pending('p1'));
    const json = state.doc.toJSON() as { content?: ProseMirrorJSONNode[] };
    const chip = JSON.stringify(json);
    expect(chip).toContain('"pending":true');
    expect(chip).toContain(`"type":"${FILE_CHIP_NAME}"`);
  });

  it('blocks on insert, unblocks when the upload resolves', () => {
    let state = EditorState.create({ schema });
    expect(isPending(state)).toBe(false); // empty composer → send allowed

    state = insertChip(state, 1, pending('p1')); // file dropped, upload starts
    expect(isPending(state)).toBe(true); // send blocked

    state = resolveChip(state, 'p1', '0190.png'); // upload finishes
    expect(isPending(state)).toBe(false); // send allowed again
  });

  it('blocks on insert, unblocks when a failed upload is removed', () => {
    let state = EditorState.create({ schema });
    state = insertChip(state, 1, pending('p1'));
    expect(isPending(state)).toBe(true);

    state = removeChip(state, 'p1'); // upload failed → placeholder removed
    expect(isPending(state)).toBe(false);
  });

  it('stays blocked while ANY of several uploads is still in flight', () => {
    // The requirement: attaching more files on top of an in-flight upload
    // is allowed, but send stays blocked until every one resolves.
    let state = EditorState.create({ schema });
    state = insertChip(state, 1, pending('a'));
    state = insertChip(state, state.doc.content.size, pending('b'));
    expect(isPending(state)).toBe(true);

    state = resolveChip(state, 'a', 'a.png');
    expect(isPending(state)).toBe(true); // 'b' still uploading → still blocked

    state = resolveChip(state, 'b', 'b.png');
    expect(isPending(state)).toBe(false); // both done → unblocked
  });

  it('a chip inserted between typed text is still detected', () => {
    // Chips are inline atoms that live mid-sentence; detection must walk
    // into the paragraph, not just scan top-level nodes.
    let state = EditorState.create({ schema });
    const tr = state.tr.insertText('look at ', 1);
    state = state.apply(tr);
    state = insertChip(state, state.doc.content.size, pending('mid'));
    expect(isPending(state)).toBe(true);

    state = resolveChip(state, 'mid', 'mid.png');
    expect(isPending(state)).toBe(false);
    // Text survives the resolve, so there's still a sendable message.
    expect(state.doc.textContent).toContain('look at ');
  });
});
