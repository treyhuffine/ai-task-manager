import { describe, expect, it, vi } from 'vitest';
import type { Attachment } from '@/db/types';
import { AppMessageGate, INTERACTION_WINDOW_MS, MAX_MESSAGE_TEXT, MAX_SENDS_PER_VIEW, SEND_SPACING_MS, appMessageParts, draftNotice, routeAppMessage, type MessageRouting, type RoutedSession } from './app-message';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const uploaded = (name: string, mimeType: string): Attachment => ({ fileName: `01900000-0000-7000-8000-00000000000${name.length % 10}.bin`, originalName: name, mimeType, size: 1, uploadedAt: '2026-10-19T00:00:00.000Z' });

describe('a message\'s content in the composer', () => {
  it('makes text plain, titled text an item, images and blobs attachments, and links their title and URI', async () => {
    const upload = vi.fn(async (file: Blob, name: string) => uploaded(name, file.type));
    const parts = await appMessageParts([
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
    expect(upload.mock.calls.map(([file, name]) => [name, file.type, file.size])).toEqual([['Front view.png', 'image/png', 68], ['nut.stl', 'model/stl', 68]]);
  });

  it('refuses content ui/message does not support, and images it cannot read', async () => {
    const upload = vi.fn();
    await expect(appMessageParts([{ type: 'audio', data: 'AA==', mimeType: 'audio/wav' }], upload)).rejects.toThrow('cannot include audio');
    await expect(appMessageParts([{ type: 'image', data: PIXEL, mimeType: 'text/html' }], upload)).rejects.toThrow('image Ri cannot read');
    expect(upload).not.toHaveBeenCalled();
  });

  it('cuts text past its limit and says so', async () => {
    const parts = await appMessageParts([{ type: 'text', text: 'x'.repeat(MAX_MESSAGE_TEXT + 10) }, { type: 'text', text: 'dropped' }], vi.fn());
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'text', text: `${'x'.repeat(MAX_MESSAGE_TEXT)} [cut]` });
  });
});

describe('sending without Send', () => {
  it('sends only while the person works in the view, spaced and bounded', () => {
    let now = 1_000_000;
    const gate = new AppMessageGate(() => now);
    // On load, before any interaction.
    expect(gate.decide(false)).toEqual({ send: false, reason: 'no-interaction' });
    // Focus held in the view counts, however long ago it arrived.
    expect(gate.decide(true)).toEqual({ send: true });
    expect(gate.decide(true)).toEqual({ send: false, reason: 'too-fast' });
    now += SEND_SPACING_MS;
    // Focus moved out, but the person pressed in the view a moment ago.
    gate.noteInteraction();
    now += INTERACTION_WINDOW_MS;
    expect(gate.decide(false)).toEqual({ send: true });
    now += SEND_SPACING_MS;
    expect(gate.decide(false)).toEqual({ send: false, reason: 'no-interaction' });
    for (let i = 2; i < MAX_SENDS_PER_VIEW; i++) { now += SEND_SPACING_MS; expect(gate.decide(true).send).toBe(true); }
    now += SEND_SPACING_MS;
    expect(gate.decide(true)).toEqual({ send: false, reason: 'limit' });
  });

  it('explains a draft quietly, without dashes or semicolons', () => {
    for (const reason of ['no-interaction', 'too-fast', 'limit', 'failed'] as const) {
      const notice = draftNotice('Bits & Bolts', reason);
      expect(notice).toMatch(/^Bits & Bolts/);
      expect(notice).not.toMatch(/[—;]/);
    }
  });
});

describe('which chat gets the message', () => {
  const routing = (sessions: Record<string, RoutedSession>) => {
    const calls: string[] = [];
    const deps: MessageRouting = {
      session: async id => sessions[id] ?? null,
      mainChat: async () => { calls.push('main'); return 'main-chat'; },
      newMainChat: async scope => { calls.push(`new-main:${scope}`); return scope ? `new-agent-chat-${scope}` : 'new-main-chat'; },
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

  it('sends active messages to the view\'s chat, and a global screen\'s to the main chat beside it', async () => {
    const { deps, calls } = routing(sessions);
    expect(await routeAppMessage('work', 'active', deps)).toBe('work');
    expect(await routeAppMessage(undefined, 'active', deps)).toBe('main-chat');
    expect(calls).toEqual(['show', 'main']);
  });

  it('starts a new conversation on the same surface', async () => {
    const { deps, calls } = routing(sessions);
    expect(await routeAppMessage('main', 'new', deps)).toBe('new-main-chat');
    expect(await routeAppMessage('agent', 'new', deps)).toBe('new-agent-chat-agent-1');
    expect(await routeAppMessage('work', 'new', deps)).toBe('new-chat-in-work');
    expect(await routeAppMessage('note', 'new', deps)).toBe('new-main-chat');
    expect(await routeAppMessage(null, 'new', deps)).toBe('new-main-chat');
    expect(calls).toEqual(['new-main:null', 'show', 'new-main:agent-1', 'new-execution:work', 'new-main:null', 'show', 'new-main:null', 'show']);
  });
});
