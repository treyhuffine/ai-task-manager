import { afterEach, expect, it, vi } from 'vitest';
import { prepareVersionReload, shouldBlockViewerUnload, viewerUnloadBlocker, UNLOAD_BLOCKER_MESSAGES } from './version-reload';
import { documentSaves } from './document-saves';
import { registerChatDraftWriter } from './chat-drafts';
import { registerCaptureWriter, retainCaptureDraft } from './capture-draft';
import { retainActiveInput } from './active-input';
const dispose: Array<() => void> = [];
afterEach(() => { for (const cleanup of dispose.splice(0)) cleanup(); vi.restoreAllMocks(); });
it('flushes safe retained chat and capture drafts without sending either', async () => {
  const save = vi.spyOn(documentSaves, 'flushAll').mockResolvedValue();
  const chat = vi.fn(() => true); const capture = vi.fn(async () => {});
  dispose.push(registerChatDraftWriter({}, chat), registerCaptureWriter({}, capture));
  await expect(prepareVersionReload(() => 0)).resolves.toBeUndefined();
  expect(save).toHaveBeenCalledOnce(); expect(chat).toHaveBeenCalledOnce(); expect(capture).toHaveBeenCalledOnce();
});
it('requires deliberate retained-draft refresh after incompatible API saves fail', async () => {
  vi.spyOn(documentSaves, 'flushAll').mockRejectedValue(new Error('unsupported API'));
  const retain = vi.spyOn(documentSaves, 'retainAll').mockImplementation(() => {});
  await expect(prepareVersionReload(() => 0)).rejects.toThrow('unsupported API');
  expect(retain).not.toHaveBeenCalled();
  await expect(prepareVersionReload(() => 0, true)).resolves.toBeUndefined();
  expect(retain).toHaveBeenCalledOnce();
});
it('never reloads when storage cannot retain a failed document, chat, or capture', async () => {
  vi.spyOn(documentSaves, 'flushAll').mockRejectedValue(new Error('unsupported API'));
  vi.spyOn(documentSaves, 'retainAll').mockImplementation(() => { throw new Error('storage full'); });
  await expect(prepareVersionReload(() => 0, true)).rejects.toThrow('storage full');
  vi.mocked(documentSaves.flushAll).mockResolvedValue();
  dispose.push(registerChatDraftWriter({}, () => false));
  await expect(prepareVersionReload(() => 0)).rejects.toThrow('chat draft');
  dispose.push(registerCaptureWriter({}, async () => { throw new Error('storage full'); }));
  await expect(prepareVersionReload(() => 0)).rejects.toThrow('capture content');
});
it('blocks active voice/input and in-flight mutations', async () => {
  const owner = {}; retainActiveInput(owner, true); dispose.push(() => retainActiveInput(owner, false));
  await expect(prepareVersionReload(() => 0, true)).rejects.toThrow('active input');
  retainActiveInput(owner, false);
  await expect(prepareVersionReload(() => 1, true)).rejects.toThrow('request');
});

it('allows only the proven immediate reload through beforeunload and restores the guard if cancelled', async () => {
  const { reloadVersion, isPreparedVersionReload } = await import('./version-reload');
  vi.spyOn(documentSaves, 'flushAll').mockResolvedValue();
  expect(isPreparedVersionReload()).toBe(false);
  const reload = vi.fn(() => { expect(isPreparedVersionReload()).toBe(true); expect(shouldBlockViewerUnload(() => 1)).toBe(false); });
  await reloadVersion(() => 0, false, reload);
  expect(reload).toHaveBeenCalledOnce();
  await new Promise(resolve => setTimeout(resolve, 1));
  expect(isPreparedVersionReload()).toBe(false);
  expect(shouldBlockViewerUnload(() => 1)).toBe(true);
  vi.mocked(documentSaves.flushAll).mockRejectedValue(new Error('draft could not save'));
  await expect(reloadVersion(() => 0, false, reload)).rejects.toThrow();
  expect(reload).toHaveBeenCalledOnce(); expect(isPreparedVersionReload()).toBe(false);
});


it('blocks an ordinary unload synchronously when the chat draft cannot be retained', () => {
  vi.spyOn(documentSaves, 'has').mockReturnValue(false);
  let retained = false;
  const chat = vi.fn(() => retained);
  dispose.push(registerChatDraftWriter({}, chat));
  expect(shouldBlockViewerUnload(() => 0)).toBe(true);
  expect(chat).toHaveBeenCalledOnce();
  retained = true;
  expect(shouldBlockViewerUnload(() => 0)).toBe(false);
  expect(chat).toHaveBeenCalledTimes(2);
});
it('keeps ordinary unload guards for failed document saves, requests, voice and unretained capture', () => {
  const hasDocuments = vi.spyOn(documentSaves, 'has').mockReturnValue(true);
  expect(shouldBlockViewerUnload(() => 0)).toBe(true);
  hasDocuments.mockReturnValue(false);
  expect(shouldBlockViewerUnload(() => 1)).toBe(true);
  const voice = {}; const capture = {};
  dispose.push(() => retainActiveInput(voice, false), () => retainCaptureDraft(capture, false));
  retainActiveInput(voice, true);
  expect(shouldBlockViewerUnload(() => 0)).toBe(true);
  retainActiveInput(voice, false);
  retainCaptureDraft(capture, true);
  expect(shouldBlockViewerUnload(() => 0)).toBe(true);
  retainCaptureDraft(capture, false);
  expect(shouldBlockViewerUnload(() => 0)).toBe(false);
});

it('names what an ordinary unload would lose, so the view can explain the leave prompt', () => {
  const hasDocuments = vi.spyOn(documentSaves, 'has').mockReturnValue(false);
  expect(viewerUnloadBlocker(() => 0)).toBeNull();
  expect(viewerUnloadBlocker(() => 1)).toBe('request');
  const capture = {}; dispose.push(() => retainCaptureDraft(capture, false));
  retainCaptureDraft(capture, true);
  expect(viewerUnloadBlocker(() => 1)).toBe('capture');
  const voice = {}; dispose.push(() => retainActiveInput(voice, false));
  retainActiveInput(voice, true);
  expect(viewerUnloadBlocker(() => 1)).toBe('input');
  hasDocuments.mockReturnValue(true);
  expect(viewerUnloadBlocker(() => 1)).toBe('document');
  dispose.push(registerChatDraftWriter({}, () => false));
  expect(viewerUnloadBlocker(() => 1)).toBe('chat');
  for (const message of Object.values(UNLOAD_BLOCKER_MESSAGES)) expect(message).not.toMatch(/[\u2014\u2013;]/);
});
