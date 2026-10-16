import { DOMParser } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTML_PREVIEW_CSP, HTML_PREVIEW_KEY_MESSAGE, HTML_PREVIEW_SANDBOX, HTML_PREVIEW_TAIL, htmlPreviewDocument, htmlPreviewKey } from './html-preview-document';

afterEach(() => vi.unstubAllGlobals());

describe('HTML preview isolation', () => {
  it('makes thumbnails static, with scripts and refresh disabled', () => {
    vi.stubGlobal('DOMParser', DOMParser);
    const preview = htmlPreviewDocument('<html><head><meta http-equiv="refresh" content="0;url=https://example.com"><style>body{color:red}</style></head><body><h1>Playbank</h1><script>fetch("/api/private")</script></body></html>', 'light', false);
    expect(preview).toContain("script-src 'none'");
    expect(preview).toContain('<h1>Playbank</h1>');
    expect(preview).toContain('body{color:red}');
    expect(preview).not.toContain('<script');
    expect(preview).not.toContain('http-equiv="refresh"');
    expect(preview).not.toContain('Choose preview variant');
  });
  it('keeps scripts runnable inside an opaque origin, with API calls and forms blocked', () => {
    expect(HTML_PREVIEW_SANDBOX).toBe('allow-scripts');
    expect(HTML_PREVIEW_CSP).toContain("script-src 'unsafe-inline'");
    expect(HTML_PREVIEW_CSP).toContain("connect-src 'none'");
    expect(HTML_PREVIEW_CSP).toContain("form-action 'none'");
    expect(HTML_PREVIEW_CSP).toContain("frame-src 'none'");
    expect(HTML_PREVIEW_CSP).toContain("base-uri 'none'");
  });

  it('places policy ahead of source scripts while preserving complete HTML and its controls', () => {
    vi.stubGlobal('DOMParser', DOMParser);
    const html = '<!doctype html><html lang="en"><head><script>window.artifactReady=true</script></head><body class="artifact"><button>Filter plays</button></body></html>';
    const preview = htmlPreviewDocument(html, 'dark');
    expect(preview).toMatch(/^<!doctype html>/);
    expect(preview.indexOf('Content-Security-Policy')).toBeLessThan(preview.indexOf('window.artifactReady'));
    expect(preview).toContain('class="artifact"');
    expect(preview).toContain('<button>Filter plays</button>');
    expect(preview).toContain('color-scheme:dark');
    expect(preview).toContain('Choose preview variant');
    expect(html).not.toContain('Content-Security-Policy');
  });
});

describe('Escape handoff from an opened preview', () => {
  it('serves the handoff ahead of the variant control, so a variant failure cannot take it along', () => {
    expect(HTML_PREVIEW_TAIL).toContain(`type: '${HTML_PREVIEW_KEY_MESSAGE}'`);
    expect(HTML_PREVIEW_TAIL.indexOf(HTML_PREVIEW_KEY_MESSAGE)).toBeLessThan(HTML_PREVIEW_TAIL.indexOf('.viz-carousel'));
    // The artifact keeps an Escape it used, and an IME keeps one mid-composition.
    expect(HTML_PREVIEW_TAIL).toContain('event.defaultPrevented || event.isComposing');
  });

  it('accepts only an Escape message, with its modifiers as booleans', () => {
    expect(htmlPreviewKey({ type: HTML_PREVIEW_KEY_MESSAGE, key: 'Escape', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }))
      .toEqual({ key: 'Escape', code: 'Escape', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false });
    expect(htmlPreviewKey({ type: HTML_PREVIEW_KEY_MESSAGE, key: 'Escape', shiftKey: true })).toMatchObject({ shiftKey: true, metaKey: false });
    expect(htmlPreviewKey({ type: HTML_PREVIEW_KEY_MESSAGE, key: 'Escape', metaKey: 'yes' })).toMatchObject({ metaKey: false });
  });

  it('ignores other keys and other messages', () => {
    expect(htmlPreviewKey({ type: HTML_PREVIEW_KEY_MESSAGE, key: 'Enter' })).toBeNull();
    expect(htmlPreviewKey({ type: 'ri:html-thumbnail', key: 'Escape' })).toBeNull();
    expect(htmlPreviewKey('Escape')).toBeNull();
    expect(htmlPreviewKey(null)).toBeNull();
  });
});
