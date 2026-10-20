import { describe, expect, it, vi } from 'vitest';
import type { Attachment } from '@/db/types';
import { AppMessageGate, MAX_MESSAGE_TEXT, MAX_SENDS_PER_VIEW, MAX_UPLOAD_BYTES_PER_VIEW, SEND_SPACING_MS, appMessageGate, appMessageParts, draftNotice, omittedNotice, routeAppMessage, type MessageRouting, type RoutedSession } from './app-message';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const uploaded = (name: string, mimeType: string): Attachment => ({ fileName: `01900000-0000-7000-8000-00000000000${name.length % 10}.bin`, originalName: name, mimeType, size: 1, uploadedAt: '2026-10-19T00:00:00.000Z' });

describe('a message\'s content in the composer', () => {
  it('makes text plain, titled text an item, images and blobs attachments, and links their title and URI', async () => {
    const upload = vi.fn(async (file: Blob, name: string) => uploaded(name, file.type));
    const { parts, omitted } = await appMessageParts([
      { type: 'text', text: 'Help me design a bracket.' },
      { type: 'text', text: 'Selected: agent dial', _meta: { 'openai/title': 'Agent dial' } },
      { type: 'image', data: PIXEL, mimeType: 'image/png', _meta: { 'openai/title': 'Front view' } },
      { type: 'resource_link', uri: 'cad://parts/washer', name: 'washer.stl', title: 'M6 washer' },
      { type: 'resource_link', uri: 'cad://parts/nut' },
      { type: 'resource', resource: { uri: 'cad://parts/nut.md', mimeType: 'text/markdown', text: '# Nut' } },
      { type: 'resource', resource: { uri: 'cad://parts/nut.stl', mimeType: 'model/stl', blob: PIXEL } },
    ], upload);
    expect(parts).toEqual([
      { type: 'text', text: 'Help me design a bracket.' },
      { type: 'snippet', title: 'Agent dial', text: 'Selected: agent dial' },
      { type: 'file', attachment: uploaded('Front view.png', 'image/png') },
      { type: 'text', text: 'M6 washer (cad://parts/washer)' },
      { type: 'text', text: 'cad://parts/nut' },
      { type: 'snippet', title: 'cad://parts/nut.md', text: '# Nut' },
      { type: 'file', attachment: uploaded('nut.stl', 'model/stl') },
    ]);
    expect(omitted).toBe(0);
    expect(upload.mock.calls.map(([file, name]) => [name, file.type, file.size])).toEqual([['Front view.png', 'image/png', 68], ['nut.stl', 'model/stl', 68]]);
  });

  it('refuses content ui/message does not support, and images it cannot read', async () => {
    const upload = vi.fn();
    await expect(appMessageParts([{ type: 'audio', data: 'AA==', mimeType: 'audio/wav' }], upload)).rejects.toThrow('cannot include audio');
    await expect(appMessageParts([{ type: 'image', data: PIXEL, mimeType: 'text/html' }], upload)).rejects.toThrow('image Ri cannot read');
    expect(upload).not.toHaveBeenCalled();
  });

  it('cuts text past its limit and says so', async () => {
    const { parts } = await appMessageParts([{ type: 'text', text: 'x'.repeat(MAX_MESSAGE_TEXT + 10) }, { type: 'text', text: 'dropped' }], vi.fn());
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'text', text: `${'x'.repeat(MAX_MESSAGE_TEXT)} [cut]` });
  });

  it('leaves files out of a message the person did not lead to, uploading nothing', async () => {
    const upload = vi.fn();
    const content = [{ type: 'text', text: 'Look at this' }, { type: 'image', data: PIXEL, mimeType: 'image/png' }, { type: 'resource', resource: { uri: 'cad://a.stl', blob: PIXEL } }];
    expect(await appMessageParts(content, upload, { files: false })).toEqual({ parts: [{ type: 'text', text: 'Look at this' }], omitted: 2 });
    expect(upload).not.toHaveBeenCalled();
  });

  it('holds each view to an upload allowance, across its messages', async () => {
    const upload = vi.fn(async (file: Blob, name: string) => uploaded(name, file.type));
    const gate = new AppMessageGate();
    expect(gate.take(MAX_UPLOAD_BYTES_PER_VIEW - 60)).toBe(true);
    // A 68-byte image no longer fits.
    expect(await appMessageParts([{ type: 'image', data: PIXEL, mimeType: 'image/png' }], upload, { budget: gate })).toEqual({ parts: [], omitted: 1 });
    expect(upload).not.toHaveBeenCalled();
    expect(omittedNotice('Bits & Bolts', 1)).toBe('Bits & Bolts\'s message left out its file.');
    expect(omittedNotice('Bits & Bolts', 3)).not.toMatch(/[—;]/);
  });
});

describe('sending without Send', () => {
  it('sends only what the person\'s own input in the view led to, spaced and bounded', () => {
    let now = 1_000_000;
    const gate = new AppMessageGate(() => now);
    // On load, or after the app focused itself: no input in the view, so a draft.
    expect(gate.decide(false)).toEqual({ send: false, reason: 'no-interaction' });
    // A click or key press in the view.
    expect(gate.decide(true)).toEqual({ send: true });
    expect(gate.decide(true)).toEqual({ send: false, reason: 'too-fast' });
    now += SEND_SPACING_MS;
    // Earlier input never carries over to a request it did not lead to.
    expect(gate.decide(false)).toEqual({ send: false, reason: 'no-interaction' });
    for (let i = 1; i < MAX_SENDS_PER_VIEW; i++) { now += SEND_SPACING_MS; expect(gate.decide(true).send).toBe(true); }
    now += SEND_SPACING_MS;
    expect(gate.decide(true)).toEqual({ send: false, reason: 'limit' });
  });

  it('keeps one gate per view, so a remount does not reset its count', () => {
    const viewId = crypto.randomUUID();
    const gate = appMessageGate(viewId);
    expect(gate.decide(true)).toEqual({ send: true });
    expect(appMessageGate(viewId)).toBe(gate);
    expect(appMessageGate(viewId).decide(true)).toEqual({ send: false, reason: 'too-fast' });
    expect(appMessageGate(crypto.randomUUID())).not.toBe(gate);
  });

  it('spaces sends by at least the browser\'s activation window, so one click sends once', () => {
    expect(SEND_SPACING_MS).toBeGreaterThanOrEqual(5_000);
  });

  it('explains a draft quietly, without dashes or semicolons', () => {
    for (const reason of ['no-interaction', 'too-fast', 'limit', 'busy', 'failed'] as const) {
      const notice = draftNotice('Bits & Bolts', reason);
      expect(notice).toMatch(/^Bits & Bolts/);
      expect(notice).not.toMatch(/[—;]/);
    }
  });
});

describe('which chat gets the message', () => {
  const routing = (sessions: Record<string, RoutedSession>, busy: (string | null)[] = []) => {
    const calls: string[] = [];
    const deps: MessageRouting = {
      session: async id => sessions[id] ?? null,
      mainChat: async () => { calls.push('main'); return 'main-chat'; },
      newMainChat: async scope => { calls.push(`new-main:${scope}`); return scope ? `new-agent-chat-${scope}` : 'new-main-chat'; },
      mainChatBusy: async scope => busy.includes(scope),
      newExecutionChat: async id => { calls.push(`new-execution:${id}`); return `new-chat-in-${id}`; },
      showMainChat: () => { calls.push('show'); },
    };
    return { deps, calls };
  };
  const sessions: Record<string, RoutedSession> = {
    main: { id: 'main', type: 'orchestration', workspaceId: null },
    agent: { id: 'agent', type: 'orchestration', workspaceId: 'agent-1' },
    work: { id: 'work', type: 'execution', workspaceId: 'agent-1' },
    note: { id: 'note', type: 'content', workspaceId: null },
  };

  const activated = { activated: true };

  it('sends active messages to the view\'s chat, and a global screen\'s to the main chat beside it', async () => {
    const { deps, calls } = routing(sessions);
    expect(await routeAppMessage('work', 'active', deps, activated)).toEqual({ chatId: 'work' });
    expect(await routeAppMessage(undefined, 'active', deps, activated)).toEqual({ chatId: 'main-chat' });
    expect(calls).toEqual(['show', 'main']);
  });

  it('starts a new conversation on the same surface', async () => {
    const { deps, calls } = routing(sessions);
    expect(await routeAppMessage('main', 'new', deps, activated)).toEqual({ chatId: 'new-main-chat' });
    expect(await routeAppMessage('agent', 'new', deps, activated)).toEqual({ chatId: 'new-agent-chat-agent-1' });
    expect(await routeAppMessage('work', 'new', deps, activated)).toEqual({ chatId: 'new-chat-in-work' });
    expect(await routeAppMessage('note', 'new', deps, activated)).toEqual({ chatId: 'new-main-chat' });
    expect(await routeAppMessage(null, 'new', deps, activated)).toEqual({ chatId: 'new-main-chat' });
    expect(calls).toEqual(['new-main:null', 'show', 'new-main:agent-1', 'new-execution:work', 'new-main:null', 'show', 'new-main:null', 'show']);
  });

  it('starts no chat and shows none for a message the person did not lead to', async () => {
    const { deps, calls } = routing(sessions);
    expect(await routeAppMessage('main', 'new', deps, { activated: false })).toEqual({ chatId: 'main' });
    expect(await routeAppMessage(null, 'new', deps, { activated: false })).toEqual({ chatId: 'main-chat' });
    expect(await routeAppMessage(undefined, 'active', deps, { activated: false })).toEqual({ chatId: 'main-chat' });
    expect(calls).toEqual(['main', 'main']);
  });

  it('never ends a main chat that is still working, leaving the message in the active chat', async () => {
    const { deps, calls } = routing(sessions, [null, 'agent-1']);
    expect(await routeAppMessage('main', 'new', deps, activated)).toEqual({ chatId: 'main', busy: true });
    expect(await routeAppMessage('agent', 'new', deps, activated)).toEqual({ chatId: 'agent', busy: true });
    expect(await routeAppMessage(null, 'new', deps, activated)).toEqual({ chatId: 'main-chat', busy: true });
    // A chat in an execution never ends another, so it opens as before.
    expect(await routeAppMessage('work', 'new', deps, activated)).toEqual({ chatId: 'new-chat-in-work' });
    expect(calls).toEqual(['show', 'main', 'new-execution:work']);
  });

  it('drafts in the active chat when the home refuses a new chat because the current one is still working', async () => {
    const { deps, calls } = routing(sessions);
    // The page thought the chat idle, but the home knows of a send waiting for a device.
    deps.newMainChat = async scope => { calls.push(`new-main:${scope}`); return null; };
    expect(await routeAppMessage('main', 'new', deps, activated)).toEqual({ chatId: 'main', busy: true });
    expect(await routeAppMessage(null, 'new', deps, activated)).toEqual({ chatId: 'main-chat', busy: true });
    expect(calls).toEqual(['new-main:null', 'new-main:null', 'show', 'main']);
  });
});
