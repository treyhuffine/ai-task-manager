import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';
import type { Attachment } from '@/db/types';

const ATT = (file_name: string, overrides: Partial<Attachment> = {}): Attachment => ({
  file_name,
  original_name: overrides.original_name ?? file_name,
  mime_type: overrides.mime_type ?? 'image/png',
  size: overrides.size ?? 1024,
  uploaded_at: overrides.uploaded_at ?? '2026-04-21T00:00:00.000Z',
});

describe('queries attachment derivation', () => {
  let tmpDir: string;
  const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
  const saveEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-queries-att-'));
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

  it('createNote stores only body-referenced attachments, discarding unreferenced hints', async () => {
    const { createNote } = await import('@/lib/db/queries');
    const note = createNote({
      body: '![](/api/attachments/a.png)',
      attachments: [ATT('a.png'), ATT('stale.png')],
    });
    expect(note.attachments?.map((a) => a.file_name)).toEqual(['a.png']);
  });

  it('updateNote re-derives when body changes', async () => {
    const { createNote, updateNote } = await import('@/lib/db/queries');
    const created = createNote({
      body: '![](/api/attachments/first.png)',
      attachments: [ATT('first.png')],
    });
    const updated = updateNote(created.id, {
      body: '![](/api/attachments/second.png)',
      attachments: [ATT('second.png')],
    });
    expect(updated?.attachments?.map((a) => a.file_name)).toEqual(['second.png']);
  });

  it('updateNote leaves attachments untouched when only unrelated fields change', async () => {
    const { createNote, updateNote } = await import('@/lib/db/queries');
    const created = createNote({
      body: '![](/api/attachments/a.png)',
      attachments: [ATT('a.png')],
    });
    const updated = updateNote(created.id, { title: 'new title' });
    expect(updated?.attachments?.map((a) => a.file_name)).toEqual(['a.png']);
  });

  it('createTask scans both description and body for references', async () => {
    const { createTask } = await import('@/lib/db/queries');
    const task = createTask({
      title: 'Bug repro',
      description: 'see ![](/api/attachments/screen.png)',
      body: 'full log ![](/api/attachments/log.txt)',
      attachments: [ATT('screen.png'), ATT('log.txt', { mime_type: 'text/plain' })],
    });
    expect(task.attachments?.map((a) => a.file_name).sort()).toEqual(['log.txt', 'screen.png']);
  });

  it('createStream derives from raw_text', async () => {
    const { createStream } = await import('@/lib/db/queries');
    const row = createStream({
      raw_text: '[voice](/api/attachments/audio.webm)',
      source: 'capture',
      media: 'voice',
      attachments: [ATT('audio.webm', { mime_type: 'audio/webm' })],
    });
    expect(row.attachments?.map((a) => a.file_name)).toEqual(['audio.webm']);
  });

  it('createArea preserves explicit attachments (no body to derive from)', async () => {
    const { createArea } = await import('@/lib/db/queries');
    const area = createArea({
      name: 'Work',
      attachments: [ATT('logo.png')],
    });
    expect(area.attachments?.map((a) => a.file_name)).toEqual(['logo.png']);
  });
});
