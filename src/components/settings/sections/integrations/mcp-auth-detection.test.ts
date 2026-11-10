import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { McpAuthDetection } from '@/lib/integrations/mcp-auth-detect';
import { describeMcpAuthDetection, detectedAuthKind, detectionFor, patchMcpForm, resolveMcpFormAuth, type McpAuthDetectionState } from './mcp-auth-detection';
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
const hasChoice = (html: string) => html.includes('name="mcp-auth"');
const hasSecret = (html: string) => html.includes('id="mcp-secret"');
/** The method whose radio is checked, or null when none is. */
const checked = (html: string) => (html.match(/<input type="radio"[^>]*>/g) ?? [])
  .find((input) => input.includes('name="mcp-auth"') && input.includes('checked=""'))?.match(/value="(\w+)"/)?.[1] ?? null;
/** One method's block: its radio, title, description and any fields under it, up to the next method's radio. */
const option = (html: string, kind: string) => {
  const start = html.indexOf(`value="${kind}"`);
  const next = html.indexOf('name="mcp-auth"', start);
  return html.slice(start, next === -1 ? html.indexOf('</form>') : next);
};
const submitDisabled = (html: string) => /<button[^>]*type="submit"[^>]*>/.exec(html)?.[0].includes('disabled=""') ?? false;
/** The methods marked Detected. */
const detectedLabels = (html: string) => [...html.matchAll(/value="(\w+)"(?:(?!value=").)*?>Detected</g)].map((m) => m[1]);

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

describe('editing the form', () => {
  it('starts over on a new address, keeping what the person typed elsewhere', () => {
    const chosen: McpForm = { ...EMPTY_MCP_FORM, name: 'Fixture', url, authKind: 'bearer', authChosen: true, secret: 'key' };
    expect(patchMcpForm(chosen, { url: 'https://other.example/mcp' })).toEqual({ ...chosen, url: 'https://other.example/mcp', authKind: 'none', authChosen: false });
    // Whitespace around the same address is not a new address.
    expect(patchMcpForm(chosen, { url: ` ${url} ` })).toEqual({ ...chosen, url: ` ${url} ` });
    expect(patchMcpForm(chosen, { name: 'Renamed' })).toEqual({ ...chosen, name: 'Renamed' });
    expect(patchMcpForm(chosen, { authKind: 'header', authChosen: true })).toEqual({ ...chosen, authKind: 'header' });
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
    expect(hasChoice(html)).toBe(false);
    expect(hasSecret(html)).toBe(false);
  });

  it('lists every method while checking, with none chosen and the add held until the probe answers', () => {
    const html = render({}, { status: 'checking', url });
    expect(html).toContain('Checking how this server authenticates');
    for (const title of ['Sign in with your browser', 'API key or token', 'API key in a custom header', 'No sign-in']) expect(html).toContain(title);
    expect(checked(html)).toBeNull();
    expect(detectedLabels(html)).toEqual([]);
    expect(submitDisabled(html)).toBe(true);
  });

  it('lets the person choose before the probe answers', () => {
    const html = render({ authKind: 'bearer', authChosen: true, secret: 'key' }, { status: 'checking', url });
    expect(checked(html)).toBe('bearer');
    expect(hasSecret(html)).toBe(true);
    expect(submitDisabled(html)).toBe(false);
  });

  it('checks the detected method and marks it Detected with what the probe found', () => {
    const noneHtml = render({}, done(none));
    expect(checked(noneHtml)).toBe('none');
    expect(detectedLabels(noneHtml)).toEqual(['none']);
    expect(noneHtml).toContain('Excalidraw answered without asking for credentials.');
    expect(noneHtml).not.toContain('Checking how this server authenticates');
    expect(hasSecret(noneHtml)).toBe(false);
    expect(noneHtml).toContain('Add and connect');

    const oauthHtml = render({}, done(oauth));
    expect(checked(oauthHtml)).toBe('oauth');
    expect(detectedLabels(oauthHtml)).toEqual(['oauth']);
    expect(oauthHtml).toContain('Ri registers itself with api.magicpath.ai and opens the sign-in page.');
    // The finding replaces the generic description, which is for a method chosen by hand.
    expect(oauthHtml).not.toContain('Ri registers itself with the server (OAuth)');
    expect(oauthHtml).toContain('Add and sign in');
    expect(hasSecret(oauthHtml)).toBe(false);
    // An API key is one click away for a server that also takes one (DataForSEO).
    expect(oauthHtml).toContain('API key or token');

    const keyHtml = render({}, done(key));
    expect(checked(keyHtml)).toBe('bearer');
    expect(detectedLabels(keyHtml)).toEqual(['bearer']);
    expect(hasSecret(keyHtml)).toBe(true);
    expect(keyHtml).not.toContain('id="mcp-header"');
    // The fields open under the method that needs them, not after the whole list.
    expect(option(keyHtml, 'bearer')).toContain('id="mcp-secret"');
    expect(option(keyHtml, 'bearer')).toContain('The secret is sealed in your Ri');

    const headerHtml = render({}, done(headerKey));
    expect(checked(headerHtml)).toBe('header');
    expect(detectedLabels(headerHtml)).toEqual(['header']);
    expect(headerHtml).toContain('id="mcp-header"');
    expect(headerHtml).toContain('placeholder="X-API-Key"');
    expect(hasSecret(headerHtml)).toBe(true);
    expect(option(headerHtml, 'header')).toContain('id="mcp-header"');
    expect(option(headerHtml, 'header')).toContain('id="mcp-secret"');
  });

  it('shows a finding that may not work in amber, still on the detected method', () => {
    const html = render({}, done({ ...oauth, registration: 'registered', authorizationServer: 'https://github.com/login/oauth' }));
    expect(detectedLabels(html)).toEqual(['oauth']);
    expect(option(html, 'oauth')).toContain('text-amber-700');
    expect(option(html, 'oauth')).toContain('github.com needs a client registered with the provider');
    expect(option(html, 'bearer')).not.toContain('text-amber-700');
  });

  it('says why when the probe has nothing to go on, and marks nothing Detected', () => {
    const html = render({}, done(unreachable));
    expect(html).toContain('Couldn&#x27;t reach this address');
    expect(html).toContain('Choose how it authenticates below.');
    expect(detectedLabels(html)).toEqual([]);
    expect(checked(html)).toBe('none');
  });

  it("respects the person's own choice over the verdict, which stays marked", () => {
    const html = render({ authKind: 'bearer', authChosen: true }, done(oauth));
    expect(checked(html)).toBe('bearer');
    expect(detectedLabels(html)).toEqual(['oauth']);
    expect(option(html, 'bearer')).toContain('id="mcp-secret"');
    expect(option(html, 'oauth')).not.toContain('id="mcp-secret"');
    expect(html).toContain('Add and connect');
  });

  it('explains OAuth chosen by hand, since no finding does', () => {
    const html = render({ authKind: 'oauth', authChosen: true }, done(unreachable));
    expect(html).toContain('Ri registers itself with the server (OAuth)');
    expect(html).toContain('Add and sign in');
  });

  it('writes no em dashes or semicolons in the method copy', () => {
    const html = render({}, { status: 'checking', url });
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/[\u2014;]/);
  });
});
