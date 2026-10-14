import { expect, it } from 'vitest';
import { artifactImageFallback, artifactImageName, imageThumbnailUrl } from './artifact-image';
import { replyImageUrl } from './reply-image-urls';

const SHA = 'c5d8ea2ecf8587bc5ae8d570fe96f5220e25cf36';
const GITHUB = `https://github.com/InsiderFinance/insiderfinance-app/blob/${SHA}/459/after-overview.jpg?raw=true`;

it('shows the source filename while preserving alt text for accessibility', () => {
  expect(artifactImageName(replyImageUrl('chat', '/tmp/Screen Shot.png'), 'The dashboard')).toBe('Screen Shot.png');
  expect(artifactImageName(replyImageUrl('chat', '/tmp/100%.png'))).toBe('100%.png');
  expect(artifactImageName(replyImageUrl('chat', 'file:///tmp/Screen%20Shot.png'))).toBe('Screen Shot.png');
  expect(artifactImageName('https://example.com/photos/court.jpg')).toBe('court.jpg');
  expect(artifactImageName('data:image/png;base64,abc', 'Diagram')).toBe('Diagram');
});

it('names a GitHub image by its file, with or without the chat route around it', () => {
  expect(artifactImageName(replyImageUrl('chat', GITHUB), 'Guide overview')).toBe('after-overview.jpg');
  expect(artifactImageName(GITHUB, 'Guide overview')).toBe('after-overview.jpg');
  expect(artifactImageName(replyImageUrl('chat', 'https://raw.githubusercontent.com/o/r/main/Screen%20Shot.png'))).toBe('Screen Shot.png');
});

it('asks only protected Ri image routes for thumbnails', () => {
  expect(imageThumbnailUrl(replyImageUrl('chat', '/tmp/a.png'))).toContain('&thumbnail=1');
  expect(imageThumbnailUrl(replyImageUrl('chat', GITHUB))).toContain('&thumbnail=1');
  expect(imageThumbnailUrl('/api/attachments/abc.png')).toBe('/api/attachments/abc.png?thumbnail=1');
  for (const url of ['https://example.com/a.png', 'https://example.com/api/attachments/a.png', 'data:image/png;base64,abc', '/images/logo.png']) expect(imageThumbnailUrl(url)).toBe(url);
});

it('knows where a failed preview can still be opened', () => {
  const page = { href: `https://github.com/InsiderFinance/insiderfinance-app/blob/${SHA}/459/after-overview.jpg`, label: 'Open on GitHub' };
  expect(artifactImageFallback(replyImageUrl('chat', GITHUB))).toEqual(page);
  expect(artifactImageFallback(GITHUB)).toEqual(page);
  // A raw address 404s in a browser for a private repository; its page does not.
  expect(artifactImageFallback(replyImageUrl('chat', `https://raw.githubusercontent.com/o/r/${SHA}/a.png`))).toEqual({ href: `https://github.com/o/r/blob/${SHA}/a.png`, label: 'Open on GitHub' });
  expect(artifactImageFallback('https://example.com/photos/court.jpg')).toEqual({ href: 'https://example.com/photos/court.jpg', label: 'Open image' });
  // A local file, an upload or inline data has nowhere else to open.
  for (const src of [replyImageUrl('chat', '/tmp/a.png'), replyImageUrl('chat', 'file:///tmp/a.png'), '/api/attachments/abc.png', 'data:image/png;base64,abc', 'blob:http://ri.local/abc']) expect(artifactImageFallback(src)).toBeNull();
});
