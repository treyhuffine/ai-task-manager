import { DOMParser } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTML_PREVIEW_CSP, HTML_PREVIEW_SANDBOX, htmlPreviewDocument } from './html-preview-document';

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
