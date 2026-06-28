import { describe, it, expect } from 'vitest';
import { hasPendingFileChip, type ProseMirrorJSONNode } from './pending-uploads';

// A pending chip is the placeholder a file gets the instant it's
// dropped/pasted — spinner shown, `fileName` still empty, `pending: true`
// — before its upload to `POST /api/attachments` resolves. The composer
// disables Send while any of these exist so a file can't be silently
// dropped from the outgoing message.

/** A paragraph wrapping the given inline children, inside a doc. */
function doc(...children: ProseMirrorJSONNode[]): ProseMirrorJSONNode {
  return { type: 'doc', content: [{ type: 'paragraph', content: children }] };
}

const text = (t: string) => ({ type: 'text', text: t }) as ProseMirrorJSONNode;
const pendingChip = (): ProseMirrorJSONNode => ({
  type: 'fileChip',
  attrs: { fileName: '', originalName: 'shot.png', pending: true, pendingId: 'abc' },
});
const resolvedChip = (): ProseMirrorJSONNode => ({
  type: 'fileChip',
  attrs: { fileName: '0190.png', originalName: 'shot.png', pending: false, pendingId: '' },
});

describe('hasPendingFileChip', () => {
  it('is false for an empty doc', () => {
    expect(hasPendingFileChip(doc())).toBe(false);
  });

  it('is false for text with no chips', () => {
    expect(hasPendingFileChip(doc(text('just typing')))).toBe(false);
  });

  it('is false when every chip has finished uploading', () => {
    expect(hasPendingFileChip(doc(text('see '), resolvedChip(), resolvedChip()))).toBe(false);
  });

  it('is true while a chip is still uploading', () => {
    expect(hasPendingFileChip(doc(text('see '), pendingChip()))).toBe(true);
  });

  it('finds a pending chip mixed in with resolved ones', () => {
    // The user attached one file, it finished, then attached another that
    // is still uploading — Send must stay blocked.
    expect(hasPendingFileChip(doc(resolvedChip(), text(' and '), pendingChip()))).toBe(true);
  });

  it('walks deeply nested content, not just the first level', () => {
    const nested: ProseMirrorJSONNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [text('intro')] },
        { type: 'paragraph', content: [resolvedChip()] },
        { type: 'paragraph', content: [text('more '), pendingChip()] },
      ],
    };
    expect(hasPendingFileChip(nested)).toBe(true);
  });

  it('does not treat a pending flag on a non-chip node as an upload', () => {
    const weird: ProseMirrorJSONNode = doc({
      type: 'paragraph',
      attrs: { pending: true },
    });
    expect(hasPendingFileChip(weird)).toBe(false);
  });

  it('honors a custom chip type name (kept bound to the schema constant)', () => {
    const node = doc({ type: 'customChip', attrs: { pending: true } });
    expect(hasPendingFileChip(node, 'customChip')).toBe(true);
    expect(hasPendingFileChip(node, 'fileChip')).toBe(false);
  });

  it('is false for null / undefined / contentless nodes', () => {
    expect(hasPendingFileChip(null)).toBe(false);
    expect(hasPendingFileChip(undefined)).toBe(false);
    expect(hasPendingFileChip({ type: 'paragraph' })).toBe(false);
  });

  it('treats only a strict true as pending (default false is not pending)', () => {
    expect(hasPendingFileChip(doc({ type: 'fileChip', attrs: { pending: false } }))).toBe(false);
    expect(hasPendingFileChip(doc({ type: 'fileChip', attrs: {} }))).toBe(false);
  });
});
