import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { assertDocumentCredential, homeDocumentKey } from '@/lib/home/document-scope';
import type { SkillView, SaveSkillResult, SaveSkillBody } from '@/lib/api/skills';
import { SkillFileSaver } from './skill-file-saver';

const skill = (patch: Partial<SkillView> = {}): SkillView => ({ ref: 'ri:review', name: 'review', location: { kind: 'ri' }, description: 'Review shared work.', updatedAt: '2026-10-20', editable: true, linkedFrom: null, hasErrors: false, uncommitted: false, dir: '<team-home>/skills/review', content: 'Original file', hash: 'first', body: 'Original', otherKeys: [], frontmatterError: null, problems: [], files: [], git: null, canWriteGlobal: false, ...patch });
let files: Map<string, string>, current: SkillView, write: Mock<(ref: string, body: SaveSkillBody) => Promise<SaveSkillResult>>, acknowledged: Mock<(result: SaveSkillResult) => void>;
const keyFor = (ref: string) => homeDocumentKey('skill', ref, { homeId: 'team', viewerId: 'owner' });
const storage = () => ({ getItem: (key: string) => files.get(key) ?? null, setItem: (key: string, value: string) => { files.set(key, value); }, removeItem: (key: string) => { files.delete(key); } });
function saver() { return new SkillFileSaver(current, keyFor, storage, write, async () => current, acknowledged); }
beforeEach(() => {
  vi.useFakeTimers(); files = new Map(); current = skill(); acknowledged = vi.fn();
  write = vi.fn(async (_ref: string, body: SaveSkillBody): Promise<SaveSkillResult> => {
    current = skill({ ...current, ref: _ref, description: body.description ?? current.description, body: body.body ?? current.body, content: body.content ?? current.content + '+', hash: current.hash + '+' });
    return { skill: current, renamedFrom: null };
  });
});
afterEach(() => vi.useRealTimers());

it('retains before debounce and serializes newer typing through acknowledgments', async () => {
  let finish!: (value: SaveSkillResult) => void;
  write.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const model = saver(); model.edit({ body: 'First edit' });
  expect(files.get(keyFor(current.ref))).toContain('First edit'); expect(write).not.toHaveBeenCalled();
  const pending = model.flush(); model.edit({ body: 'Newer typing' });
  finish({ skill: skill({ body: 'First edit', hash: 'second' }), renamedFrom: null });
  await pending;
  expect(write.mock.calls).toEqual([[current.ref, { body: 'First edit', description: 'Review shared work.', baseHash: 'first' }], [current.ref, { body: 'Newer typing', description: 'Review shared work.', baseHash: 'second' }]]);
  expect(model.snapshot().draft.body).toBe('Newer typing'); expect(model.hasUnsaved()).toBe(false); expect(files.size).toBe(0);
});

it('offers retained text explicitly and fences its Home and author', async () => {
  const first = saver(); first.edit({ body: 'Retained edit' }); first.dispose();
  const reopened = saver(); expect(reopened.snapshot().draft.body).toBe('Original'); expect(reopened.snapshot().recovery?.draft.body).toBe('Retained edit');
  await vi.advanceTimersByTimeAsync(1000); expect(write).not.toHaveBeenCalled();
  expect(new SkillFileSaver(current, ref => homeDocumentKey('skill', ref, { homeId: 'team', viewerId: 'member' }), storage, write, async () => current, acknowledged).snapshot().recovery).toBeNull();
  reopened.restore(); await reopened.flush(); expect(current.body).toBe('Retained edit');
});

it('pauses a retained old base and a live conflict until the person chooses', async () => {
  const first = saver(); first.edit({ body: 'Mine' }); first.dispose(); current = skill({ body: 'Another author', hash: 'second' });
  const model = saver(); model.restore(); await expect(model.flush()).rejects.toThrow(/Resolve/); expect(write).not.toHaveBeenCalled();
  expect(model.snapshot().conflict?.body).toBe('Another author'); model.keepMine(); await model.flush(); expect(current.body).toBe('Mine');
  model.edit({ body: 'Next' }); current = skill({ body: 'New shared version', hash: 'third' }); model.observe(current);
  model.takeTheirs(); expect(model.snapshot().draft.body).toBe('New shared version'); expect(model.hasUnsaved()).toBe(false);
});

it('keeps refused input and prevents a changed sign-in from becoming its author', async () => {
  let liveCredential = 'original';
  const captured = liveCredential;
  const model = new SkillFileSaver(current, keyFor, storage, async (ref, body) => { assertDocumentCredential(captured, liveCredential); return write(ref, body); }, async () => current, acknowledged);
  model.edit({ body: 'Original author only' }); liveCredential = 'replacement';
  await expect(model.flush()).rejects.toThrow(/original author/); expect(write).not.toHaveBeenCalled(); expect(files.get(keyFor(current.ref))).toContain('Original author only');
  liveCredential = 'original'; write.mockRejectedValueOnce(new ApiError(403, { error: 'Owner access was removed' }, '/skills'));
  await expect(model.flush()).rejects.toThrow(); await vi.advanceTimersByTimeAsync(1000);
  expect(write).toHaveBeenCalledTimes(1); expect(model.hasUnsaved()).toBe(true); expect(model.snapshot().error).toContain('Owner access');
  model.observe(skill({ editable: false })); model.edit({ body: 'Forbidden new edit' }); expect(model.snapshot().draft.body).toBe('Original author only');
});

it('fetches a stale file without replacing local typing', async () => {
  const model = saver(); model.edit({ body: 'Mine' }); current = skill({ body: 'Theirs', hash: 'second' });
  write.mockRejectedValueOnce(new ApiError(409, { code: 'stale' }, '/skills'));
  await expect(model.flush()).rejects.toThrow(); expect(model.snapshot().conflict?.body).toBe('Theirs'); expect(model.snapshot().draft.body).toBe('Mine');
});

it('moves retained identity during a file rename and keeps newer input on the new ref', async () => {
  const model = saver(); await model.switchMode('file'); model.edit({ content: 'Renamed file' });
  let finish!: (value: SaveSkillResult) => void;
  write.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = model.flush(); model.edit({ content: 'Newer renamed file' });
  finish({ skill: skill({ ref: 'ri:renamed', name: 'renamed', content: 'Renamed file', hash: 'second' }), renamedFrom: 'ri:review' });
  await pending;
  expect(write.mock.calls[1]).toEqual(['ri:renamed', { content: 'Newer renamed file', baseHash: 'second' }]);
  expect(files.has(keyFor('ri:review'))).toBe(false); expect(model.snapshot().saved.ref).toBe('ri:renamed');
});
