import { expect, it } from 'vitest';
import { artifactImageName, artifactImageSource, imageResponseError, imageThumbnailUrl } from './artifact-image';
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

it('reveals the original local path or external URL without dumping image data', () => {
  expect(artifactImageSource(imageThumbnailUrl(replyImageUrl('chat', '/tmp/Screen Shot 100%.png')))).toBe('/tmp/Screen Shot 100%.png');
  expect(artifactImageSource(replyImageUrl('chat', 'screenshots/home.png'))).toBe('screenshots/home.png');
  expect(artifactImageSource(replyImageUrl('chat', 'file:///tmp/Screen%20Shot.png'))).toBe('file:///tmp/Screen%20Shot.png');
  const github = 'https://github.com/example/private/blob/abc/shot.png?raw=true';
  expect(artifactImageSource(github)).toBe(github);
  expect(artifactImageSource('https://example.com/reply-image?path=/tmp/a.png')).toBe('https://example.com/reply-image?path=/tmp/a.png');
  expect(artifactImageSource('/api/attachments/upload.png')).toBe('/api/attachments/upload.png');
  expect(artifactImageSource('data:image/png;base64,abc')).toBe('Embedded image (data URL)');
  expect(artifactImageSource('blob:http://localhost/abc')).toBe('Temporary image (blob URL)');
});

it('keeps server failure reasons and status codes, with a safe fallback for non-JSON errors', async () => {
  expect(await imageResponseError(Response.json({ error: 'This image is on MacBook.' }, { status: 409 }))).toBe('HTTP 409: This image is on MacBook.');
  expect(await imageResponseError(Response.json({ error: 'unauthorized', message: 'Sign in to view this image.' }, { status: 401 }))).toBe('HTTP 401: Sign in to view this image.');
  for (const body of ['<html>Not found</html>', '', 'null', '{"error":{}}', '{"error":""}']) {
    expect(await imageResponseError(new Response(body, { status: 404 }))).toBe('HTTP 404');
  }
});
