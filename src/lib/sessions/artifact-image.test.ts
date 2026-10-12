import { expect, it } from 'vitest';
import { artifactImageName, imageThumbnailUrl } from './artifact-image';
import { replyImageUrl } from './reply-image-urls';

it('shows the source filename while preserving alt text for accessibility', () => {
  expect(artifactImageName(replyImageUrl('chat', '/tmp/Screen Shot.png'), 'The dashboard')).toBe('Screen Shot.png');
  expect(artifactImageName(replyImageUrl('chat', '/tmp/100%.png'))).toBe('100%.png');
  expect(artifactImageName(replyImageUrl('chat', 'file:///tmp/Screen%20Shot.png'))).toBe('Screen Shot.png');
  expect(artifactImageName('https://example.com/photos/court.jpg')).toBe('court.jpg');
  expect(artifactImageName('data:image/png;base64,abc', 'Diagram')).toBe('Diagram');
});

it('asks only protected Ri image routes for thumbnails', () => {
  expect(imageThumbnailUrl(replyImageUrl('chat', '/tmp/a.png'))).toContain('&thumbnail=1');
  expect(imageThumbnailUrl('/api/attachments/abc.png')).toBe('/api/attachments/abc.png?thumbnail=1');
  for (const url of ['https://example.com/a.png', 'https://example.com/api/attachments/a.png', 'data:image/png;base64,abc', '/images/logo.png']) expect(imageThumbnailUrl(url)).toBe(url);
});
