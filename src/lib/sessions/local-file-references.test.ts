import { expect, it } from 'vitest';
import { rewriteLocalArtifacts } from './reply-artifacts';
import { rewriteLocalText } from './reply-text';
import { rewriteLocalImages } from './reply-image-urls';
import { rewriteLocalHtml } from './reply-html';
import { rewriteLocalPdfs } from './reply-pdf';

const rewrite = (text: string, base?: string) => [rewriteLocalImages, rewriteLocalHtml, rewriteLocalPdfs, rewriteLocalText, rewriteLocalArtifacts]
  .reduce((markdown, render) => render(markdown, 'chat', base), text);

it('leaves the reported API routes and unqualified filenames exactly as written', () => {
  const message = 'Use `/v1/realtime/status/flow`, `/v1/products/option-flow/count` and `/flow`.\n\nThe files are `FlowFeed.ts`, `FeedPublisher.ts` and both copies of `protocol.ts`.\n\nVerified browser/gallery and desktop/mobile.';
  expect(rewrite(message)).toBe(message);
});

it.each(['FlowFeed.ts', 'report.pdf', 'shot.png', 'index.html', 'movie.mp4', 'README', 'docs/README', '/flow', './output'])('does not infer a clickable file from %s', target => {
  for (const text of [target, `\`${target}\``, `"${target}"`]) expect(rewrite(text)).toBe(text);
});

it.each(['/Users/agent/report.txt', '~/report.md', './src/file.ts', '../src/file.ts', 'src/file.ts', 'src/file.ts:12:4', 'docs/plan.md#decisions', 'file:///tmp/review.txt', 'data/output.zip'])('keeps the full inferred path and inline code styling for %s', target => {
  const rendered = rewrite(`Open \`${target}\`.`);
  expect(rendered).toMatch(/^Open <code><ri-(text|file)-preview /);
  expect(rendered).toContain(`>${target}</ri-`);
  expect(rendered).toMatch(/<\/ri-(text|file)-preview><\/code>\.$/);
});

it('keeps quotes and displayed relative paths even when the destination resolves against a document', () => {
  const rendered = rewrite('See "./My Notes.md" and ../archive/output.zip.', '/tmp/docs/review.md');
  expect(rendered).toContain('"<ri-text-preview href="#ri-text=%2Ftmp%2Fdocs%2FMy%20Notes.md">./My Notes.md</ri-text-preview>"');
  expect(rendered).toContain('<ri-file-preview href="#ri-file=%2Ftmp%2Farchive%2Foutput.zip">../archive/output.zip</ri-file-preview>.');
});

it('preserves authored labels, extensionless file links, web links and dedicated renderers', () => {
  expect(rewrite('[Source](FlowFeed.ts)')).toContain('>Source</ri-text-preview>');
  expect(rewrite('[Build](Dockerfile)')).toContain('>Build</ri-text-preview>');
  expect(rewrite('[Output](/tmp/output)')).toContain('<ri-file-preview');
  expect(rewrite('[Image](shot.png)')).toContain('![Image](/api/sessions/chat/reply-image?path=shot.png)');
  expect(rewrite('[PDF](report.pdf)')).toContain('<ri-pdf-preview');
  expect(rewrite('[HTML](index.html)')).toContain('<ri-html-preview');
  const web = 'https://example.com/a/path.ts?x=1#section\n\n[The docs](https://example.com/docs)';
  expect(rewrite(web)).toBe(web);
});
