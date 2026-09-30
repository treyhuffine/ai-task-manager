import { expect, it } from 'vitest';
import { assertLocalBridge, isLocalViewer, isViewerReload, remoteViewerOrigin, trustedViewerFrame, viewerPermission } from './viewer-trust';
import { desktopRequestHeaders } from './trust';
import type { BackendReady } from './config';

const local: BackendReady = { type: 'ready', connection: 'home', origin: 'https://localhost:4224', certificate: 'pinned', token: 'sign-in', desktopClient: 'native' };
it('requires a local session, certificate and capability, never inferring privilege from a URL', () => {
  expect(isLocalViewer(local)).toBe(true);
  expect(isLocalViewer({ ...local, connection: 'remote' })).toBe(false);
  expect(isLocalViewer({ ...local, desktopClient: undefined })).toBe(false);
  expect(isLocalViewer({ ...local, certificate: '' })).toBe(false);
});
it('remote viewer requests cannot supply or acquire a native capability', () => {
  for (const nativeRequest of [true, false]) expect(desktopRequestHeaders({ headers: { 'X-Ri-Desktop-Client': 'forged', Accept: 'text/html' }, url: 'https://mini.example/api/service', origin: 'https://mini.example', nativeRequest, trustedMainFrame: true })).toEqual({ Accept: 'text/html' });
});
it('accepts only exact main-frame identity and origin for renderer actions', () => {
  const input = { senderId: 1, windowId: 1, mainFrame: true, url: 'https://mini.example/path', origin: 'https://mini.example' };
  expect(trustedViewerFrame(input)).toBe(true);
  expect(trustedViewerFrame({ ...input, mainFrame: false })).toBe(false);
  expect(trustedViewerFrame({ ...input, senderId: 2 })).toBe(false);
  expect(trustedViewerFrame({ ...input, url: 'https://mini.example.attacker.test' })).toBe(false);
});
it('requires standard HTTPS and origin-only addresses, with an explicit local development exception', () => {
  expect(remoteViewerOrigin('https://mini.example')).toBe('https://mini.example');
  expect(remoteViewerOrigin('http://127.0.0.1:42241', true)).toBe('http://127.0.0.1:42241');
  for (const url of ['http://127.0.0.1', 'http://mini.example', 'file:///etc/passwd', 'https://secret@mini.example', 'https://mini.example/path', 'https://mini.example/#token=secret']) expect(() => remoteViewerOrigin(url)).toThrow();
  expect(() => remoteViewerOrigin('http://mini.example', true)).toThrow();
});


it('accepts legacy bridge 1 and compatible rolling runtime releases, rejecting an unsupported native bridge', () => {
  expect(() => assertLocalBridge()).not.toThrow();
  expect(() => assertLocalBridge({ compatibility: { nativeBridge: [1, 2] } })).not.toThrow();
  expect(() => assertLocalBridge({ compatibility: { nativeBridge: [2] } })).toThrow('Update the Ri desktop app');
});


it('denies Chromium notification permission so Home pages cannot bypass local native consent', () => {
  for (const origin of ['https://localhost:4224', 'https://mini.example']) {
    expect(viewerPermission({ permission: 'notifications', senderId: 1, windowId: 1, isMainFrame: true, requestingUrl: origin + '/', origin })).toBe(false);
  }
});
it('allows required viewer permissions only for the actual main document', () => {
  const frame = { senderId: 1, windowId: 1, isMainFrame: true, requestingUrl: 'https://mini.example/task', origin: 'https://mini.example' };
  for (const permission of ['media', 'clipboard-sanitized-write', 'fullscreen']) {
    expect(viewerPermission({ ...frame, permission })).toBe(true);
    for (const denied of [
      { isMainFrame: false }, // Includes same-origin embedded documents.
      { isMainFrame: undefined },
      { senderId: 2 },
      { senderId: undefined }, // Service worker or a request without a document.
      { windowId: undefined },
      { requestingUrl: undefined },
      { requestingUrl: 'https://mini.example.attacker.test/' },
      { requestingUrl: 'http://mini.example/' },
    ]) expect(viewerPermission({ ...frame, permission, ...denied })).toBe(false);
  }
  for (const permission of ['clipboard-read', 'display-capture', 'geolocation', 'fileSystem', 'openExternal']) expect(viewerPermission({ ...frame, permission })).toBe(false);
});

it('leaves only exact trusted-document reloads to the existing beforeunload guard', () => {
  const origin = 'https://mini.example';
  const current = `${origin}/note/one?view=full#body`;
  expect(isViewerReload(current, current, origin)).toBe(true);
  for (const target of [
    `${origin}/note/two?view=full#body`, `${origin}/note/one?view=other#body`,
    `${origin}/note/one?view=full#other`, 'https://other.example/note/one',
    'https://mini.example.attacker.test/', 'http://mini.example/',
    'about:blank', 'data:text/html,test', 'file:///tmp/note.html',
  ]) {
    expect(isViewerReload(target, current, origin)).toBe(false);
    if (!target.startsWith(`${origin}/`)) expect(isViewerReload(target, target, origin)).toBe(false);
  }
  expect(isViewerReload(current, `${origin}/note/two`, origin)).toBe(false);
});
