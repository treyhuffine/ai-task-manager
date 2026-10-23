import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CHAT_UI_EXAMPLES, filterGalleryExamples, galleryExample, galleryPreviewUrl, GALLERY_ORIGINS } from './catalog';
import { GalleryRuntime } from './runtime';
import { DRAFT_ID, mentionExample } from './fixtures';

describe('central chat UI catalog', () => {
  it('has unique links and states, real source references and no onboarding entries', () => {
    expect(new Set(CHAT_UI_EXAMPLES.map(example => example.id)).size).toBe(CHAT_UI_EXAMPLES.length);
    for (const example of CHAT_UI_EXAMPLES) {
      expect(example.states.length).toBeGreaterThan(0);
      expect(new Set(example.states.map(state => state.id)).size).toBe(example.states.length);
      for (const source of example.sources) {
        expect(existsSync(path.resolve(source)), source).toBe(true);
        if (example.origin === 'ri' && source.startsWith('src/components/')) expect(source).toMatch(/^src\/components\/(?:chat-ui\/|mcp-apps\/form\/)/);
      }
      expect(example.sources.every(source => !source.includes('onboarding'))).toBe(true);
      expect(`${example.name} ${example.description} ${example.tryThis} ${example.availability}`).not.toMatch(/[—;]/);
      expect(galleryPreviewUrl(example.id)).toBe(`/chat-ui-gallery/${example.id}.html`);
    }
    expect(new Set(CHAT_UI_EXAMPLES.map(example => example.origin))).toEqual(new Set(Object.keys(GALLERY_ORIGINS)));
  });

  it('searches names, capabilities and source paths, while respecting origin filters', () => {
    expect(filterGalleryExamples(' Gmail   draft ', 'ri').map(example => example.id)).toEqual(['email']);
    expect(filterGalleryExamples('pending-input-area', 'all').map(example => example.id)).toEqual(['questions', 'permissions']);
    expect(filterGalleryExamples('', 'connected').map(example => example.id)).toEqual(['connected-app']);
    expect(filterGalleryExamples('', 'kit').map(example => example.id)).toEqual(['app-kit']);
    expect(filterGalleryExamples('a phrase that matches nothing', 'all')).toEqual([]);
    expect(galleryExample('unknown').id).toBe('email');
    expect(galleryPreviewUrl('../../api/send')).toBe('/chat-ui-gallery/email.html');
  });
});

describe('isolated gallery operations', () => {
  it('binds the HTML file to an agent so the shared file hook can resolve its authorized scope', async () => {
    const html = new GalleryRuntime('html', 'interactive');
    expect(await html.invoke('sessions.get', {})).toMatchObject({ workspaceId: expect.any(String) });
    expect(await html.invoke('sessions.fileGet', { query: { path: 'review-plan.html' } })).toMatchObject({ content: expect.stringContaining('Record an example decision'), tooLarge: false });
  });
  it('edits and simulates a send in one example without changing another example', async () => {
    const one = new GalleryRuntime('email', 'draft');
    const two = new GalleryRuntime('email', 'draft');
    await one.invoke('email.update', { id: DRAFT_ID, expectedRevision: 0, patch: { body: 'A local edit' } });
    await one.invoke('email.send', { id: DRAFT_ID, expectedRevision: 1 });
    expect(one.email).toMatchObject({ status: 'sent', body: 'A local edit' });
    expect(two.email.status).toBe('draft');
    expect(two.email.body).not.toBe('A local edit');
    expect(one.logs).toContain('Simulated send complete. No email was sent');
  });

  it('has no fallback for an unknown operation', async () => {
    const fixture = new GalleryRuntime('email', 'draft');
    await expect(fixture.invoke('integrations.runPost', { body: { actionId: 'gmail.send_email' } })).rejects.toThrow(/no fixture/);
    expect(fixture.logs).toEqual([]);
  });

  it('answers questions and approval requests using only fixture state', async () => {
    const question = new GalleryRuntime('questions', 'single');
    expect(question.pending).toHaveLength(1);
    expect(await question.invoke('sessions.runtimeStatusGet', {})).toMatchObject({ running: true, canStop: true, backgroundTasks: false });
    await question.invoke('sessions.pendingInputRequestIdPost', { body: { answers: { Meeting: 'Video call' } } });
    expect(question.pending).toHaveLength(0);
    expect(await question.invoke('sessions.runtimeStatusGet', {})).toMatchObject({ running: false, canStop: true });
    expect(question.logs).toContain('Example answer: Video call');
    const approval = new GalleryRuntime('approvals', 'pending');
    await approval.invoke('integrations.approvePost', { body: { ids: ['gallery-approval'], decision: 'approve' } });
    expect(await approval.invoke('integrations.pendingApprovalsGet', {})).toEqual({ pending: [] });
    expect(approval.events.filter(event => event.source === 'approval_response')).toHaveLength(1);
  });

  it('retains unavailable states and exposes a connected view without consulting installed apps', async () => {
    const expired = new GalleryRuntime('connected-app', 'expired');
    await expect(expired.invoke('connectedApps.open', {})).rejects.toThrow(/expired/);
    const fixtureResource = { html: 'example' };
    const connected = new GalleryRuntime('connected-app', 'live', fixtureResource);
    expect(await connected.invoke('connectedApps.open', {})).toMatchObject({ resource: fixtureResource, title: 'Example app · Project estimate' });
    expect(await connected.invoke('connectedApps.invoke', { args: { hours: 10 } })).toMatchObject({ result: { structuredContent: { total: 1200 } } });
  });

  it('resolves fictional mentioned accounts, naming a lone account by its service and two by their accounts', async () => {
    const one = new GalleryRuntime('mentions', 'one');
    const [todoist] = mentionExample('one').sources;
    expect(await one.invoke('chatSources.resolve', { chatId: 'gallery', refs: [todoist.sourceRef, 'unknown'] })).toMatchObject([{ chipLabel: 'Todoist', mark: { kind: 'provider', providerId: 'todoist' } }, { status: 'unavailable' }]);
    const several = mentionExample('several').sources;
    expect(several.map(source => source.chipLabel)).toEqual(['Gmail · Work', 'Gmail · Personal']);
    expect(mentionExample('attention').sources.map(source => source.status)).toEqual(['needs_access', 'ready']);
    await one.invoke('chatSources.requestAccess', {});
    expect(one.logs).toContain('Example access requested. No account permissions changed');
  });
});


it('validates, settles and keeps a service form separate from another example', async () => {
  const form = new GalleryRuntime('server-form', 'open');
  const other = new GalleryRuntime('server-form', 'open');
  expect(await form.invoke('connectedApps.forms.forView', {})).toEqual([]);
  expect(await form.invoke('connectedApps.forms.answer', { answer: { action: 'accept', content: {} } })).toMatchObject({ status: 'open', errors: { project: expect.any(String) } });
  expect(form.logs).toEqual([]);
  expect(await form.invoke('connectedApps.forms.get', {})).toMatchObject({ status: 'open', again: {}, message: 'Enter a project name.' });
  expect(await form.invoke('connectedApps.forms.answer', { answer: { action: 'accept', content: { project: 'Friday release', priority: 'normal', ready: true } } })).toEqual({ status: 'accepted', errors: {} });
  expect(await form.invoke('connectedApps.forms.answer', { answer: { action: 'decline' } })).toEqual({ status: 'accepted', errors: {} });
  expect(await other.invoke('connectedApps.forms.get', {})).toMatchObject({ status: 'open' });
  const expired = new GalleryRuntime('server-form', 'expired');
  expect(await expired.invoke('connectedApps.forms.answer', { answer: { action: 'accept', content: {} } })).toEqual({ status: 'expired', errors: {} });
});
