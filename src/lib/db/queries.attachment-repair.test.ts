import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Attachment } from '@/db/types';
import { APP_SHORT_ID } from '@/constants/app';

vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/embeddings/embed')>(),
  upsertEmbedding: vi.fn(async () => {}),
}));
vi.setConfig({ testTimeout: 30_000 });

describe('note attachment metadata repair query', () => {
  let tmpDir: string;
  const prefix = APP_SHORT_ID.toUpperCase();
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-query-att-repair-'));
    vi.stubEnv(`${prefix}_ROOT`, tmpDir);
    vi.stubEnv(`${prefix}_DB_PATH`, path.join(tmpDir, 'data.db'));
    vi.stubEnv(`${prefix}_MIRROR_DISABLED`, '1');
    vi.resetModules();
  });
  afterEach(async () => {
    const { resetDb } = await import('@/lib/db');
    resetDb();
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function setup() {
    const q = await import('@/lib/db/queries');
    const { getAttachmentsDir } = await import('@/lib/config/paths');
    fs.mkdirSync(getAttachmentsDir(), { recursive: true });
    const attachments: Attachment[] = ['first.png', 'second.png'].map((fileName) => ({
      fileName, originalName: `Screenshot ${fileName}`, mimeType: 'image/png',
      size: 4, uploadedAt: '2026-04-21T00:00:00.000Z',
    }));
    for (const a of attachments) fs.writeFileSync(path.join(getAttachmentsDir(), a.fileName), 'test');
    const body = attachments.map((a) => `![](/api/attachments/${a.fileName})`).join('\n');
    const source = q.createNote({ title: 'Original note', body, attachments });
    const target = q.createNote({ title: 'Copied note', body, contextTags: ['preserve'], url: 'https://example.com' });
    return { q, source, target, attachments, input: {
      sourceNoteId: source.id, targetNoteId: target.id, fileNames: ['first.png'],
    } };
  }

  it('persists only selected metadata, updates the mirror, and leaves content and embeddings unchanged', async () => {
    const { q, source, target, attachments, input } = await setup();
    const { upsertEmbedding } = await import('@/lib/embeddings/embed');
    vi.mocked(upsertEmbedding).mockClear();
    const { getAttachmentsDir } = await import('@/lib/config/paths');
    const bytesBefore = fs.readFileSync(path.join(getAttachmentsDir(), 'first.png'));
    vi.stubEnv(`${prefix}_MIRROR_DISABLED`, '0');
    const result = await q.repairNoteAttachmentMetadata(input);
    expect(result).toEqual({ sourceNoteId: source.id, targetNoteId: target.id, repairedFileNames: ['first.png'], unchangedFileNames: [] });
    const after = q.getNote(target.id)!;
    expect(after.attachments).toEqual([attachments[0], target.attachments![1]]);
    expect({ ...after, attachments: target.attachments, updatedAt: target.updatedAt }).toEqual(target);
    expect(q.getNote(source.id)).toEqual(source);
    expect(fs.readFileSync(path.join(getAttachmentsDir(), 'first.png'))).toEqual(bytesBefore);
    expect(upsertEmbedding).not.toHaveBeenCalled();
    expect(q.listEntityVersions('note', target.id)).toHaveLength(0);
    const { findByIdInType } = await import('@/lib/export/mirror/fs');
    const [mirror] = await findByIdInType('note', target.id);
    const rendered = fs.readFileSync(mirror, 'utf8');
    expect(rendered).toContain('Screenshot first.png');
    expect(rendered).toContain('image/png');
    expect(rendered).toContain('application/octet-stream');
    expect(rendered).toContain('../attachments/first.png');
  });

  it('is retry-safe without another timestamp or content change', async () => {
    const { q, target, input } = await setup();
    await q.repairNoteAttachmentMetadata(input);
    const after = q.getNote(target.id);
    const retried = await q.repairNoteAttachmentMetadata(input);
    expect(retried.repairedFileNames).toEqual([]);
    expect(retried.unchangedFileNames).toEqual(['first.png']);
    expect(q.getNote(target.id)).toEqual(after);
  });

  it('validates the whole batch before writing anything', async () => {
    const { q, source, target, input } = await setup();
    const { getAttachmentsDir } = await import('@/lib/config/paths');
    fs.writeFileSync(path.join(getAttachmentsDir(), 'second.png'), 'bad size');
    await expect(q.repairNoteAttachmentMetadata({ ...input, fileNames: ['first.png', 'second.png'] }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(q.getNote(target.id)).toEqual(target);
    expect(q.getNote(source.id)).toEqual(source);
  });

  it.each(['sourceNoteId', 'targetNoteId'] as const)('returns not_found for missing %s', async (field) => {
    const { q, target, input } = await setup();
    await expect(q.repairNoteAttachmentMetadata({ ...input, [field]: 'missing' }))
      .rejects.toMatchObject({ code: 'not_found' });
    expect(q.getNote(target.id)).toEqual(target);
  });
});
