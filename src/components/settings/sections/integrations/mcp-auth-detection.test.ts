import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { McpAuthDetection } from '@/lib/integrations/mcp-auth-detect';
import { describeMcpAuthDetection, detectedAuthKind, detectionFor, resolveMcpFormAuth, type McpAuthDetectionState } from './mcp-auth-detection';
import { McpServerForm } from './mcp-server-detail';
import { EMPTY_MCP_FORM, type McpForm } from './types';

const url = 'https://mcp.example/mcp';
const none: McpAuthDetection = { method: 'none', server: { name: 'Excalidraw', version: '1.0.0' } };
const oauth: McpAuthDetection = { method: 'oauth', registration: 'dynamic', authorizationServer: 'https://api.magicpath.ai/', scopes: ['magicpath:read', 'magicpath:write'], pkce: true };
const key: McpAuthDetection = { method: 'key', status: 401 };
const headerKey: McpAuthDetection = { method: 'key', status: 403, header: 'X-API-Key' };
const unreachable: McpAuthDetection = { method: 'unknown', reason: 'unreachable', message: 'Nothing is listening at this address.' };
const done = (detection: McpAuthDetection): McpAuthDetectionState => ({ status: 'done', url, detection });

function render(form: Partial<McpForm>, detection: McpAuthDetectionState) {
  return renderToStaticMarkup(createElement(McpServerForm, {
    form: { ...EMPTY_MCP_FORM, name: 'Fixture', url, ...form }, detection, busy: false, onChange: vi.fn(), onSubmit: vi.fn(), onBack: vi.fn(),
  }));
}
const hasSelect = (html: string) => html.includes('id="mcp-auth"');
const hasSecret = (html: string) => html.includes('id="mcp-secret"');

describe('what a verdict preselects', () => {
  it('maps each method to the form, and leaves an unknown verdict to the person', () => {
    expect(detectedAuthKind(none)).toBe('none');
    expect(detectedAuthKind(oauth)).toBe('oauth');
    expect(detectedAuthKind(key)).toBe('bearer');
    expect(detectedAuthKind(headerKey)).toBe('header');
    expect(detectedAuthKind(unreachable)).toBeNull();
  });

  it('belongs to the address it was asked for', () => {
    expect(detectionFor(done(none), ` ${url} `)).toEqual(none);
    expect(detectionFor(done(none), 'https://other.example/mcp')).toBeNull();
    expect(detectionFor({ status: 'checking', url }, url)).toBeNull();
  });

  it("submits the detected method until the person chooses, and falls back to the named header", () => {
    const form: McpForm = { ...EMPTY_MCP_FORM, url, authKind: 'none' };
    expect(resolveMcpFormAuth(form, oauth)).toEqual({ authKind: 'oauth', header: '' });
    expect(resolveMcpFormAuth(form, headerKey)).toEqual({ authKind: 'header', header: 'X-API-Key' });
    expect(resolveMcpFormAuth({ ...form, header: ' X-Token ' }, headerKey)).toEqual({ authKind: 'header', header: 'X-Token' });
    expect(resolveMcpFormAuth({ ...form, authKind: 'bearer', authChosen: true }, oauth)).toEqual({ authKind: 'bearer', header: '' });
    expect(resolveMcpFormAuth({ ...form, authKind: 'bearer' }, unreachable)).toEqual({ authKind: 'bearer', header: '' });
    expect(resolveMcpFormAuth(form, null)).toEqual({ authKind: 'none', header: '' });
  });
});

describe('what the verdict says', () => {
  it.each<[string, McpAuthDetection, string, string]>([
    ['none', none, 'No sign-in needed', 'Excalidraw answered without asking for credentials.'],
    ['key', key, 'Needs an API key or token', 'refused the request (HTTP 401) without offering browser sign-in. Paste the key it gave you.'],
    ['header', headerKey, 'Needs an API key or token', 'It names the X-API-Key header.'],
    ['dynamic', oauth, 'Sign in with your browser', 'Ri registers itself with api.magicpath.ai and opens the sign-in page. It asks for magicpath:read, magicpath:write.'],
    ['registered', { ...oauth, registration: 'registered', authorizationServer: 'https://github.com/login/oauth' }, 'Sign in with your browser', 'github.com needs a client registered with the provider, which a custom server can\'t supply here. If the server also takes an API key, use that.'],
    ['client metadata', { ...oauth, registration: 'client_metadata' }, 'Sign in with your browser', 'takes a client metadata document instead of registering clients'],
    ['unknown registration', { ...oauth, registration: 'unknown' }, 'Sign in with your browser', "couldn't read the sign-in details at api.magicpath.ai, so sign-in may need a registered client."],
    ['no PKCE', { ...oauth, pkce: false }, 'Sign in with your browser', "It doesn't offer PKCE S256, which Ri requires."],
    ['many scopes', { ...oauth, scopes: ['READ_SHEETS', 'CREATE_SHEETS', 'WRITE_SHEETS', 'DELETE_SHEETS', 'ADMIN_SHEETS', 'SHARE_SHEETS'] }, 'Sign in with your browser', 'It asks for READ_SHEETS, CREATE_SHEETS, WRITE_SHEETS and 3 more.'],
    ['unreachable', unreachable, "Couldn't reach this address", 'Nothing is listening at this address. Choose how it authenticates below.'],
    ['redirected', { method: 'unknown', reason: 'redirected', message: 'This address redirects to https://x.example.' }, 'This address redirects', 'Choose how it authenticates below.'],
    ['not MCP', { method: 'unknown', reason: 'not_mcp', message: 'No.' }, 'No MCP server here', 'No. Choose how it authenticates below.'],
    ['server error', { method: 'unknown', reason: 'server_error', message: 'HTTP 503.' }, 'The server is having trouble', 'HTTP 503.'],
    ['invalid URL', { method: 'unknown', reason: 'invalid_url', message: 'Use an https:// URL.' }, 'Check the address', 'Use an https:// URL.'],
  ])('%s', (_, detection, title, detail) => {
    const summary = describeMcpAuthDetection(detection);
    expect(summary.title).toBe(title);
    expect(summary.detail).toContain(detail);
    expect(`${summary.title} ${summary.detail}`).not.toMatch(/[—;]/);
  });

  it('warns rather than reassures when sign-in may not work', () => {
    expect(describeMcpAuthDetection(oauth).tone).toBe('ok');
    expect(describeMcpAuthDetection({ ...oauth, registration: 'registered' }).tone).toBe('warn');
    expect(describeMcpAuthDetection({ ...oauth, pkce: false }).tone).toBe('warn');
    expect(describeMcpAuthDetection(none).tone).toBe('ok');
    expect(describeMcpAuthDetection(unreachable).tone).toBe('warn');
  });
});

describe('the add form', () => {
  it('asks for the URL first and shows no auth choice before it', () => {
    const html = render({ url: '' }, { status: 'idle' });
    expect(html).toContain('Enter the server URL and Ri works out how it authenticates.');
    expect(hasSelect(html)).toBe(false);
    expect(hasSecret(html)).toBe(false);
  });

  it('says it is checking, with a way to choose instead', () => {
    const html = render({}, { status: 'checking', url });
    expect(html).toContain('Checking how this server authenticates');
    expect(html).toContain('Choose instead');
    expect(hasSelect(html)).toBe(false);
  });

  it('shows only the detected method with a quiet Change, and the matching fields', () => {
    const noneHtml = render({}, done(none));
    expect(noneHtml).toContain('No sign-in needed');
    expect(noneHtml).toContain('>Change<');
    expect(hasSelect(noneHtml)).toBe(false);
    expect(hasSecret(noneHtml)).toBe(false);
    expect(noneHtml).toContain('Add and connect');

    const oauthHtml = render({}, done(oauth));
    expect(oauthHtml).toContain('Sign in with your browser');
    expect(oauthHtml).toContain('Use an API key instead');
    expect(oauthHtml).toContain('Add and sign in');
    expect(hasSecret(oauthHtml)).toBe(false);
    // The verdict already explains sign-in. The generic OAuth note is for a choice made by hand.
    expect(oauthHtml).not.toContain('We register a client automatically');

    const keyHtml = render({}, done(key));
    expect(keyHtml).toContain('Needs an API key or token');
    expect(hasSecret(keyHtml)).toBe(true);
    expect(keyHtml).not.toContain('id="mcp-header"');
    expect(hasSelect(keyHtml)).toBe(false);

    const headerHtml = render({}, done(headerKey));
    expect(headerHtml).toContain('id="mcp-header"');
    expect(headerHtml).toContain('placeholder="X-API-Key"');
    expect(hasSecret(headerHtml)).toBe(true);
  });

  it('keeps the full choice when the probe has nothing to go on', () => {
    const html = render({}, done(unreachable));
    expect(html).toContain('Couldn&#x27;t reach this address');
    expect(html).toContain('Choose how it authenticates below.');
    expect(hasSelect(html)).toBe(true);
    expect(html).toMatch(/<option value="none"[^>]*selected/);
  });

  it("respects the person's own choice over the verdict", () => {
    const html = render({ authKind: 'bearer', authChosen: true }, done(oauth));
    expect(hasSelect(html)).toBe(true);
    expect(html).toMatch(/<option value="bearer"[^>]*selected/);
    expect(hasSecret(html)).toBe(true);
    expect(html).toContain('Add and connect');
    expect(html).not.toContain('>Change<');
  });

  it('explains OAuth chosen by hand, since no verdict does', () => {
    const html = render({ authKind: 'oauth', authChosen: true }, done(unreachable));
    expect(html).toContain('We register a client automatically');
    expect(html).toContain('Add and sign in');
  });
});
