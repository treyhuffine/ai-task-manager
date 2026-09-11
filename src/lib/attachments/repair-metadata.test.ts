import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Attachment } from '@/db/types';
import { APP_SHORT_ID } from '@/constants/app';
import { getAttachmentsDir } from '@/lib/config/paths';
import { planNoteAttachmentMetadataRepair } from './repair-metadata';

const authoritative: Attachment = {
  fileName: 'existing.png', originalName: 'Original screenshot.png',
  mimeType: 'image/png', size: 4, uploadedAt: '2026-04-21T00:00:00.000Z',
};
const stub: Attachment = {
  fileName: 'existing.png', originalName: 'existing.png',
  mimeType: 'application/octet-stream', size: 0, uploadedAt: '2026-09-10T00:00:00.000Z',
};
const body = '![](/api/attachments/existing.png)';

describe('copied-note attachment metadata repair plan', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-att-repair-'));
    vi.stubEnv(`${APP_SHORT_ID.toUpperCase()}_ROOT`, tmpDir);
    fs.mkdirSync(getAttachmentsDir(), { recursive: true });
    fs.writeFileSync(path.join(getAttachmentsDir(), authoritative.fileName), 'test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function input() {
    return {
      source: { id: 'source', body, attachments: [{ ...authoritative }] },
      target: { id: 'target', body, attachments: [{ ...stub }] },
      fileNames: ['existing.png'],
    };
  }

  it('copies only metadata without mutating either input, preserving other records and order', () => {
    const args = input();
    const unrelated = { ...authoritative, fileName: 'unrelated.png' };
    args.target.attachments.unshift(unrelated);
    const before = structuredClone(args);
    const result = planNoteAttachmentMetadataRepair(args);
    expect(result.attachments).toEqual([unrelated, authoritative]);
    expect(result.repairedFileNames).toEqual(['existing.png']);
    expect(args).toEqual(before);
    expect(result.attachments[0]).toBe(unrelated);
  });

  it('returns an unchanged plan for already identical metadata', () => {
    const args = input();
    args.target.attachments = [{ ...authoritative }];
    expect(planNoteAttachmentMetadataRepair(args)).toEqual({
      attachments: args.target.attachments, repairedFileNames: [],
    });
  });

  it.each([
    [], ['existing.png', 'existing.png'], ['../existing.png'], ['/tmp/existing.png'],
    ['existing.png/another'], ['existing.png?name=x'], Array.from({ length: 101 }, (_, i) => `${i}.png`),
  ].map((fileNames) => ({ fileNames })))('rejects invalid selections $fileNames', ({ fileNames }) => {
    expect(() => planNoteAttachmentMetadataRepair({ ...input(), fileNames })).toThrow(/distinct storage filenames/);
  });

  it('rejects the same source and target note', () => {
    const args = input();
    args.target.id = args.source.id;
    expect(() => planNoteAttachmentMetadataRepair(args)).toThrow(/must be different/);
  });

  it.each(['source', 'target'] as const)('rejects unreferenced or mismatched %s records', (side) => {
    const args = input();
    args[side].body = '![](/api/attachments/different.png)';
    expect(() => planNoteAttachmentMetadataRepair(args)).toThrow(/referenced in both/);
    args[side].body = body;
    args[side].attachments[0].fileName = 'different.png';
    expect(() => planNoteAttachmentMetadataRepair(args)).toThrow(/exactly one/);
  });

  it.each(['source', 'target'] as const)('rejects duplicate %s metadata records', (side) => {
    const args = input();
    args[side].attachments.push({ ...args[side].attachments[0] });
    expect(() => planNoteAttachmentMetadataRepair(args)).toThrow(/exactly one/);
  });

  it.each([
    { originalName: '' }, { mimeType: 'application/octet-stream' }, { size: 0 },
    { size: -1 }, { size: 1.5 }, { uploadedAt: 'not a date' }, { uploadedAt: '2026-04-21' },
    { mimeType: 'image/jpeg' },
  ])('rejects incomplete or inconsistent source metadata %j', (change) => {
    const args = input();
    Object.assign(args.source.attachments[0], change);
    expect(() => planNoteAttachmentMetadataRepair(args)).toThrow(/incomplete or inconsistent/);
  });

  it.each([
    { originalName: 'A real upload.png' }, { mimeType: 'image/png' }, { size: 4 },
  ])('rejects non-stub target conflicts %j', (change) => {
    const args = input();
    Object.assign(args.target.attachments[0], change);
    expect(() => planNoteAttachmentMetadataRepair(args)).toThrow(/non-stub/);
  });

  it('rejects a storage-size mismatch', () => {
    fs.writeFileSync(path.join(getAttachmentsDir(), authoritative.fileName), 'different bytes');
    expect(() => planNoteAttachmentMetadataRepair(input())).toThrow(/matching the source size/);
  });

  it('rejects a missing storage file', () => {
    fs.unlinkSync(path.join(getAttachmentsDir(), authoritative.fileName));
    expect(() => planNoteAttachmentMetadataRepair(input())).toThrow(/file not found/);
  });

  it('rejects symlinks even when the destination size matches', () => {
    const file = path.join(getAttachmentsDir(), authoritative.fileName);
    const elsewhere = path.join(tmpDir, 'elsewhere.png');
    fs.renameSync(file, elsewhere);
    fs.symlinkSync(elsewhere, file);
    expect(() => planNoteAttachmentMetadataRepair(input())).toThrow(/regular file/);
  });
});
