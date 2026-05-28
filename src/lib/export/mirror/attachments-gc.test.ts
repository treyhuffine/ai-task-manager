import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

const ENV_PREFIX = APP_SHORT_ID.toUpperCase();
const APP_ROOT_ENV = `${ENV_PREFIX}_ROOT`;
const DB_PATH_ENV = `${ENV_PREFIX}_DB_PATH`;
const MIRROR_DISABLED_ENV = `${ENV_PREFIX}_MIRROR_DISABLED`;
const ATTACHMENT_GC_ENV = `${ENV_PREFIX}_ATTACHMENT_GC`;
const MANAGED_ENV_KEYS = [APP_ROOT_ENV, DB_PATH_ENV, MIRROR_DISABLED_ENV, ATTACHMENT_GC_ENV];

describe('sweepAttachments', () => {
  let tmpDir: string;
  const saveEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-gc-test-'));
    for (const k of MANAGED_ENV_KEYS) saveEnv[k] = process.env[k];
    process.env[APP_ROOT_ENV] = tmpDir;
    process.env[DB_PATH_ENV] = path.join(tmpDir, 'data.db');
    process.env[MIRROR_DISABLED_ENV] = '1';
    delete process.env[ATTACHMENT_GC_ENV];
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of MANAGED_ENV_KEYS) {
      if (saveEnv[k] === undefined) delete process.env[k];
      else process.env[k] = saveEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not archive orphans when GC is disabled (default)', async () => {
    const { saveAttachment } = await import('@/lib/attachments/save');
    const { sweepAttachments } = await import('./attachments-gc');

    const orphan = await saveAttachment({
      data: Buffer.from('uncited'),
      originalName: 'Leftover.png',
      mimeType: 'image/png',
    });

    const stats = await sweepAttachments();
    expect(stats.gcEnabled).toBe(false);
    expect(stats.archived).toBe(0);
    expect(stats.onDisk).toBe(1);

    const attachmentsDir = path.join(tmpDir, 'brain', 'attachments');
    expect(fs.existsSync(path.join(attachmentsDir, orphan.fileName))).toBe(true);
  });

  it('archives orphans only when GC is explicitly enabled', async () => {
    process.env[ATTACHMENT_GC_ENV] = '1';

    const { createArea, createNote } = await import('@/lib/db/queries');
    const { saveAttachment } = await import('@/lib/attachments/save');
    const { sweepAttachments } = await import('./attachments-gc');

    const kept = await saveAttachment({
      data: Buffer.from('referenced'),
      originalName: 'Cover.png',
      mimeType: 'image/png',
    });
    const orphan = await saveAttachment({
      data: Buffer.from('uncited'),
      originalName: 'Leftover.png',
      mimeType: 'image/png',
    });

    createArea({ name: 'Area with cover', attachments: [kept] });
    createNote({ body: `![Cover](/api/attachments/${kept.fileName})` });

    const stats = await sweepAttachments();
    expect(stats.gcEnabled).toBe(true);
    expect(stats.referenced).toBe(1);
    expect(stats.archived).toBe(1);

    const attachmentsDir = path.join(tmpDir, 'brain', 'attachments');
    const archiveDir = path.join(tmpDir, 'brain', '.archive', 'attachments');
    expect(fs.existsSync(path.join(attachmentsDir, kept.fileName))).toBe(true);
    expect(fs.existsSync(path.join(attachmentsDir, orphan.fileName))).toBe(false);
    expect(fs.existsSync(path.join(archiveDir, orphan.fileName))).toBe(true);
  });

  it('treats workspace attachments as referenced (regression: was missed)', async () => {
    process.env[ATTACHMENT_GC_ENV] = '1';

    const { createWorkspace } = await import('@/lib/db/queries');
    const { saveAttachment } = await import('@/lib/attachments/save');
    const { sweepAttachments } = await import('./attachments-gc');

    const photo = await saveAttachment({
      data: Buffer.from('workspace photo'),
      originalName: 'cover.png',
      mimeType: 'image/png',
    });

    createWorkspace({
      name: 'My workspace',
      cwd: tmpDir,
      attachments: [photo],
    });

    const stats = await sweepAttachments();
    expect(stats.archived).toBe(0);
    expect(stats.referenced).toBe(1);

    const attachmentsDir = path.join(tmpDir, 'brain', 'attachments');
    expect(fs.existsSync(path.join(attachmentsDir, photo.fileName))).toBe(true);
  });

  it('treats chat_events attachments as referenced (regression: was missed)', async () => {
    process.env[ATTACHMENT_GC_ENV] = '1';

    const { getDb } = await import('@/lib/db');
    const { agents, chatSessions, chatEvents } = await import('@/lib/db/schema');
    const { dehydrateAttachments } = await import('@/lib/db/hydrate');
    const { saveAttachment } = await import('@/lib/attachments/save');
    const { sweepAttachments } = await import('./attachments-gc');

    const file = await saveAttachment({
      data: Buffer.from('chat photo'),
      originalName: 'chat.png',
      mimeType: 'image/png',
    });

    const db = getDb();
    db.insert(agents)
      .values({ id: 'ag-1', kind: 'orchestrator', name: 'test', harness: 'test' })
      .run();
    db.insert(chatSessions)
      .values({ id: 'cs-1', agentId: 'ag-1', type: 'orchestration', label: 'test' })
      .run();
    db.insert(chatEvents)
      .values({
        id: 'ev-1',
        sessionId: 'cs-1',
        role: 'user',
        source: 'user',
        content: `[[file:${file.fileName}]]`,
        attachments: dehydrateAttachments([file]) ?? [],
      })
      .run();

    const stats = await sweepAttachments();
    expect(stats.archived).toBe(0);
    expect(stats.referenced).toBe(1);

    const attachmentsDir = path.join(tmpDir, 'brain', 'attachments');
    expect(fs.existsSync(path.join(attachmentsDir, file.fileName))).toBe(true);
  });

  it('restores a referenced file that was incorrectly archived earlier', async () => {
    const { createNote } = await import('@/lib/db/queries');
    const { saveAttachment } = await import('@/lib/attachments/save');
    const { sweepAttachments } = await import('./attachments-gc');

    const file = await saveAttachment({
      data: Buffer.from('photo bytes'),
      originalName: 'photo.png',
      mimeType: 'image/png',
    });

    // Simulate a prior bad sweep: file got moved to archive while the DB
    // reference is still live. The next sweep must heal this.
    const attachmentsDir = path.join(tmpDir, 'brain', 'attachments');
    const archiveDir = path.join(tmpDir, 'brain', '.archive', 'attachments');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.renameSync(
      path.join(attachmentsDir, file.fileName),
      path.join(archiveDir, file.fileName),
    );

    createNote({ body: `![](/api/attachments/${file.fileName})` });

    const stats = await sweepAttachments();
    expect(stats.restored).toBe(1);
    expect(fs.existsSync(path.join(attachmentsDir, file.fileName))).toBe(true);
    expect(fs.existsSync(path.join(archiveDir, file.fileName))).toBe(false);
  });

  it('tolerates a missing attachments directory', async () => {
    const { sweepAttachments } = await import('./attachments-gc');
    const stats = await sweepAttachments();
    expect(stats.archived).toBe(0);
    expect(stats.restored).toBe(0);
  });
});
