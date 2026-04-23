import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

/**
 * End-to-end-ish GC test: seed the DB with entities that reference some
 * attachment file_names, create files on disk (some referenced, some not),
 * run the sweep, and verify orphans land in `.archive/attachments/`.
 */
describe('sweepAttachments', () => {
  let tmpDir: string;
  const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
  const saveEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-gc-test-'));
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
    process.env[appRootEnv] = tmpDir;
    process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
    process.env[mirrorDisabledEnv] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
      if (saveEnv[k] === undefined) delete process.env[k];
      else process.env[k] = saveEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves unreferenced files into .archive/attachments/ and leaves referenced ones', async () => {
    // Seed the DB by calling queries directly.
    const { createArea, createNote } = await import('@/lib/db/queries');
    const { saveAttachment } = await import('@/lib/attachments/save');
    const { sweepAttachments } = await import('./attachments-gc');

    const kept = await saveAttachment({
      data: Buffer.from('referenced'),
      original_name: 'Cover.png',
      mime_type: 'image/png',
    });
    const orphan = await saveAttachment({
      data: Buffer.from('uncited'),
      original_name: 'Leftover.png',
      mime_type: 'image/png',
    });

    createArea({
      name: 'Area with cover',
      attachments: [kept],
    });

    // Note body references `kept`; server derive will populate attachments[].
    createNote({
      body: `![Cover](/api/attachments/${kept.file_name})`,
    });

    const stats = await sweepAttachments();
    expect(stats.referenced).toBe(1);
    expect(stats.onDisk).toBe(2);
    expect(stats.archived).toBe(1);

    const attachmentsDir = path.join(tmpDir, 'brain', 'attachments');
    const archiveDir = path.join(tmpDir, 'brain', '.archive', 'attachments');
    expect(fs.existsSync(path.join(attachmentsDir, kept.file_name))).toBe(true);
    expect(fs.existsSync(path.join(attachmentsDir, orphan.file_name))).toBe(false);
    expect(fs.existsSync(path.join(archiveDir, orphan.file_name))).toBe(true);
  });

  it('no-ops cleanly when nothing is orphaned', async () => {
    const { saveAttachment } = await import('@/lib/attachments/save');
    const { createNote } = await import('@/lib/db/queries');
    const { sweepAttachments } = await import('./attachments-gc');

    const a = await saveAttachment({
      data: Buffer.from('a'),
      original_name: 'x.png',
      mime_type: 'image/png',
    });
    createNote({ body: `![](/api/attachments/${a.file_name})` });

    const stats = await sweepAttachments();
    expect(stats.archived).toBe(0);
    expect(stats.onDisk).toBe(1);
    expect(stats.referenced).toBe(1);
  });

  it('tolerates a missing attachments directory', async () => {
    const { sweepAttachments } = await import('./attachments-gc');
    const stats = await sweepAttachments();
    expect(stats.archived).toBe(0);
  });
});
