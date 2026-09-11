import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';
import type { EntityType } from './config';
import { mirrorFilename, mirrorLinkPath, renderArea, renderNote, renderStream, renderTask } from './render';

vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/embeddings/embed')>(),
  upsertEmbedding: vi.fn(async () => {}),
}));
vi.setConfig({ testTimeout: 30_000 });

describe('archive-aware mirror links', () => {
  let root: string;
  const prefix = APP_SHORT_ID.toUpperCase();

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-mirror-archive-links-'));
    vi.stubEnv(`${prefix}_ROOT`, root);
    vi.stubEnv(`${prefix}_DB_PATH`, path.join(root, 'data.db'));
    vi.stubEnv(`${prefix}_MIRROR_DISABLED`, '1');
    vi.stubEnv(`${prefix}_ATTACHMENT_GC`, '0');
    vi.resetModules();
  });

  afterEach(async () => {
    const { resetDb } = await import('@/lib/db');
    resetDb();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function sync(type: EntityType, id: string) {
    const { syncEntity } = await import('./sync');
    vi.stubEnv(`${prefix}_MIRROR_DISABLED`, '0');
    await syncEntity(type, id);
    vi.stubEnv(`${prefix}_MIRROR_DISABLED`, '1');
  }

  function file(type: EntityType, title: string | null, id: string, archived = false) {
    return path.join(root, archived ? '.archive' : '', `${type}s`, mirrorFilename(title, id));
  }

  it('cascades task/note inline backlinks through rename, archive, and restore without changing stored content', async () => {
    const q = await import('@/lib/db/queries');
    const { saveAttachment } = await import('@/lib/attachments/save');
    const image = await saveAttachment({ data: Buffer.from('image bytes'), originalName: 'Image.png', mimeType: 'image/png' });
    const imagePath = path.join(root, 'attachments', image.fileName);
    const task = q.createTask({ title: 'Original task', body: `![image](/api/attachments/${image.fileName})`, attachments: [image] });
    const note = q.createNote({ title: 'Original note', body: `[[task:${task.id}]]\n![image](/api/attachments/${image.fileName})`, attachments: [image] });
    const linker = q.createTask({ title: 'Working task', description: `[[note:${note.id}]]`, body: `[[task:${task.id}]]\n\`[[note:${note.id}]]\`` });
    const linkedNote = q.createNote({ title: 'Working note', body: `[[note:${note.id}]]` });
    const originalLinker = q.getTask(linker.id);
    const originalLinkedNote = q.getNote(linkedNote.id);
    const originalBody = task.body;
    const noteBody = note.body;
    await sync('task', task.id);
    await sync('note', note.id);

    q.updateTask(task.id, { title: 'Renamed task' });
    q.transitionTask({ taskId: task.id, command: 'archive', idempotencyKey: 'archive' });
    await sync('task', task.id);
    const archivedTask = file('task', 'Renamed task', task.id, true);
    expect(fs.existsSync(archivedTask)).toBe(true);
    expect(fs.existsSync(file('task', task.title, task.id))).toBe(false);
    expect(fs.readFileSync(file('task', linker.title, linker.id), 'utf8')).toContain(`[[${mirrorLinkPath('task', 'Renamed task', task.id, true)}]]`);
    expect(fs.readFileSync(file('note', note.title, note.id), 'utf8')).toContain(`[[${mirrorLinkPath('task', 'Renamed task', task.id, true)}]]`);
    expect(fs.readFileSync(archivedTask, 'utf8')).toContain(`../../attachments/${image.fileName}`);

    q.updateNote(note.id, { status: 'archived' });
    await sync('note', note.id);
    expect(fs.readFileSync(file('task', linker.title, linker.id), 'utf8')).toContain(`[[${mirrorLinkPath('note', note.title, note.id, true)}]]`);
    expect(fs.readFileSync(file('note', linkedNote.title, linkedNote.id), 'utf8')).toContain(`[[${mirrorLinkPath('note', note.title, note.id, true)}]]`);
    expect(fs.readFileSync(file('task', linker.title, linker.id), 'utf8')).toContain(`\`[[note:${note.id}]]\``);
    expect(fs.readFileSync(file('note', note.title, note.id, true), 'utf8')).toContain(`../../attachments/${image.fileName}`);

    q.transitionTask({ taskId: task.id, command: 'restore', idempotencyKey: 'restore' });
    q.updateNote(note.id, { status: 'active' });
    await sync('task', task.id);
    await sync('note', note.id);
    const restored = fs.readFileSync(file('task', linker.title, linker.id), 'utf8');
    expect(restored).toContain(`[[${mirrorLinkPath('task', 'Renamed task', task.id)}]]`);
    expect(restored).toContain(`[[${mirrorLinkPath('note', note.title, note.id)}]]`);
    expect(restored).not.toContain('.archive/');
    expect(fs.existsSync(archivedTask)).toBe(false);
    expect(fs.existsSync(file('note', note.title, note.id, true))).toBe(false);
    expect(q.getTask(task.id)?.body).toBe(originalBody);
    expect(q.getTask(task.id)?.attachments).toEqual(task.attachments);
    expect(q.getNote(note.id)?.body).toBe(noteBody);
    expect(q.getNote(note.id)?.attachments).toEqual(note.attachments);
    expect(q.getTask(linker.id)).toEqual(originalLinker);
    expect(q.getNote(linkedNote.id)).toEqual(originalLinkedNote);
    expect(fs.readFileSync(imagePath)).toEqual(Buffer.from('image bytes'));
    expect(restored).not.toContain('write SQL directly');
  });

  it('resolves area, parent, linked task, stream source and outcome paths across archive and restore', async () => {
    const q = await import('@/lib/db/queries');
    const area = q.createArea({ name: 'Source area' });
    const parent = q.createTask({ title: 'Parent task', areaId: area.id });
    const child = q.createTask({ title: 'Child task', parentId: parent.id, areaId: area.id });
    const note = q.createNote({ title: 'Linked note', body: '', taskId: parent.id, areaId: area.id });
    const stream = q.createStream({ rawText: 'Capture image ![](/api/attachments/capture.png)', source: 'capture' });
    q.createStreamLinks([
      { streamId: stream.id, entityType: 'task', entityId: child.id, relation: 'created' },
      { streamId: stream.id, entityType: 'note', entityId: note.id, relation: 'created' },
    ]);
    q.updateArea(area.id, { status: 'archived' });
    q.transitionTask({ taskId: parent.id, command: 'archive', idempotencyKey: 'parent-archive', acknowledgedChildIds: [child.id] });
    q.updateStream(stream.id, { status: 'dismissed' });
    await sync('area', area.id);
    await sync('task', parent.id);
    await sync('stream', stream.id);
    for (const [type, row] of [['task', child], ['note', note]] as const) {
      const content = fs.readFileSync(file(type, row.title, row.id), 'utf8');
      expect(content).toContain(`[[${mirrorLinkPath('area', area.name, area.id, true)}]]`);
      expect(content).toContain(`[[${mirrorLinkPath('task', parent.title, parent.id, true)}]]`);
      expect(content).toContain('.archive/streams/');
      expect(content).toContain('> Capture image ![](../attachments/capture.png)');
    }
    q.updateNote(note.id, { status: 'archived' });
    await sync('note', note.id);
    const streamFile = file('stream', stream.rawText.slice(0, 40), stream.id, true);
    expect(fs.readFileSync(streamFile, 'utf8')).toContain(`[[${mirrorLinkPath('note', note.title, note.id, true)}]]`);
    expect(fs.readFileSync(streamFile, 'utf8')).toContain('../../attachments/capture.png');
    expect(fs.readFileSync(file('note', note.title, note.id, true), 'utf8')).toContain('> Capture image ![](../../attachments/capture.png)');

    q.updateArea(area.id, { status: 'active' });
    q.transitionTask({ taskId: parent.id, command: 'restore', idempotencyKey: 'parent-restore' });
    q.updateStream(stream.id, { status: 'pending' });
    q.updateNote(note.id, { status: 'active' });
    await sync('area', area.id);
    await sync('task', parent.id);
    await sync('stream', stream.id);
    await sync('note', note.id);
    expect(fs.readFileSync(file('task', child.title, child.id), 'utf8')).not.toContain('.archive/');
    expect(fs.readFileSync(file('note', note.title, note.id), 'utf8')).not.toContain('.archive/');
    expect(fs.existsSync(streamFile)).toBe(false);
  });

  it('renders attachments relative to each containing entity, not the quoted source status', async () => {
    const q = await import('@/lib/db/queries');
    const text = '![](/api/attachments/image.png)';
    const source = q.createStream({ rawText: text, source: 'capture' });
    const task = q.createTask({ title: 'Task', body: text, description: text, userContext: text });
    const note = q.createNote({ title: 'Note', body: text });
    const area = q.createArea({ name: 'Area', description: text, notes: text, userContext: text });
    for (const archived of [false, true]) {
      const relative = archived ? '../../attachments/' : '../attachments/';
      const results = [
        renderTask({ ...task, status: archived ? 'archived' : 'todo' }, { sources: [source] }),
        renderNote({ ...note, status: archived ? 'archived' : 'active' }, { sources: [source] }),
        renderArea({ ...area, status: archived ? 'archived' : 'active' }),
        renderStream({ ...source, status: archived ? 'dismissed' : 'pending' }),
      ];
      for (const { content } of results) {
        // Area descriptions remain verbatim in frontmatter as metadata.
        const renderedBody = content.slice(content.indexOf('<!--'));
        expect(renderedBody).not.toContain('/api/attachments/');
        expect(renderedBody).toContain(`![](${relative}image.png)`);
      }
    }
  });

  it('force-reconciles unchanged records while normal background passes retain timestamp skipping', async () => {
    const q = await import('@/lib/db/queries');
    const task = q.createTask({ title: 'Task', body: 'task body' });
    const note = q.createNote({ title: 'Note', body: 'note body' });
    const area = q.createArea({ name: 'Area', notes: 'area body' });
    const { reconcileAll } = await import('./reconcile');
    vi.stubEnv(`${prefix}_MIRROR_DISABLED`, '0');
    await reconcileAll();
    const rows = [['task', task, task.title], ['note', note, note.title], ['area', area, area.name]] as const;
    for (const [type, row, title] of rows) {
      const p = file(type, title, row.id);
      // Simulate a mirror made by an old renderer without changing its timestamp.
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/<!-- Managed by.*-->/, '<!-- old renderer -->'));
    }
    expect((await reconcileAll()).skipped).toBe(3);
    for (const [type, row, title] of rows) expect(fs.readFileSync(file(type, title, row.id), 'utf8')).toContain('old renderer');
    const forced = await reconcileAll({ force: true });
    expect(forced.skipped).toBe(0);
    expect(forced.synced).toBe(3);
    for (const [type, row, title] of rows) expect(fs.readFileSync(file(type, title, row.id), 'utf8')).not.toContain('old renderer');
    expect(q.getTask(task.id)).toEqual(task);
    expect(q.getNote(note.id)).toEqual(note);
    expect(q.getArea(area.id)).toEqual(area);
  });
});
