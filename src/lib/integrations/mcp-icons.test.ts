import { describe, expect, it } from 'vitest';
import { safeMcpIcon, safeViewThumbnail } from './mcp-icons';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('icons and thumbnails', () => {
  it('lets a server name its icons by https or an image data URL', () => {
    expect(safeMcpIcon({ src: 'https://cdn.example/icon.png' })).toEqual({ src: 'https://cdn.example/icon.png' });
    expect(safeMcpIcon({ src: PIXEL })).toEqual({ src: PIXEL });
    expect(safeMcpIcon({ src: 'javascript:alert(1)' })).toBeNull();
  });

  it('takes a thumbnail from a view only as an image data URL, so Ri\'s page never fetches what a view names', () => {
    expect(safeViewThumbnail({ src: PIXEL, mimeType: 'image/png' })).toEqual({ src: PIXEL, mimeType: 'image/png' });
    expect(safeViewThumbnail({ src: 'https://thumbs.example/washer.png?selected=secret' })).toBeNull();
    expect(safeViewThumbnail({ src: 'data:text/html;base64,PGgxPg==' })).toBeNull();
    expect(safeViewThumbnail(undefined)).toBeNull();
  });
});
