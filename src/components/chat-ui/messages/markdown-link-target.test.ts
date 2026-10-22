import { describe, expect, it } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { markdownLinkTarget, markdownWebUrl, remarkChatLinks } from './markdown-link-target';

describe('Markdown web destinations', () => {
  it.each([
    ['https://example.com/a?x=1&y=2#part', 'https://example.com/a?x=1&y=2#part'],
    ['HTTP://localhost:42241/test', 'http://localhost:42241/test'],
    ['https://127.0.0.1:8080/', 'https://127.0.0.1:8080/'],
    ['http://[::1]:3000/', 'http://[::1]:3000/'],
    ['https://例え.jp/案内', 'https://xn--r8jz45g.jp/%E6%A1%88%E5%86%85'],
    ['//example.com/guide', 'https://example.com/guide'],
    ['www.example.com', 'https://www.example.com/'],
    ['docs.example.com:8080/guide', 'https://docs.example.com:8080/guide'],
    [' example.com/guide ', 'https://example.com/guide'],
  ])('recognizes %s as a web URL', (target, url) => expect(markdownWebUrl(target)).toBe(url));

  it.each([
    undefined, '', 'README.md', 'src/app.tsx', '/tmp/report.txt', './example.com/guide', '../notes.md',
    '~/Documents/report.pdf', 'C:\\Users\\sam\\notes.md', 'file:///tmp/report.txt', '#section',
    '/api/attachments/report.pdf', 'mailto:sam@example.com', 'tel:+15551234567', 'ftp://example.com/file',
    'javascript:alert(1)', 'data:text/html,hello', 'streamdown:incomplete-link', 'https://',
    'https://exa mple.com', 'https://example.com\n.evil.test', 'https://[invalid]', 'https://example.com:99999',
    'https://example.com\\@evil.test', 'www.',
  ])('keeps %s out of direct web navigation', target => expect(markdownWebUrl(target)).toBeNull());
});

it('preserves exact paths and reference destinations without touching code or images', () => {
  const tree = fromMarkdown('[Source](../src/app.tsx) [Readme][readme] [Web](//example.com/a) ![Image](./shot.png) ![Shared definition][readme] `x.md`\n\n[readme]: README.md\n\n```md\n[Code](example.com/a)\n```');
  remarkChatLinks()(tree);
  const paragraph = tree.children[0];
  if (paragraph.type !== 'paragraph') throw new Error('Expected a paragraph');
  const links = paragraph.children.filter(node => node.type === 'link');
  expect(markdownLinkTarget(links[0].url)).toBe('../src/app.tsx');
  expect(markdownLinkTarget(links[1].url)).toBe('README.md');
  expect(links[2].url).toBe('https://example.com/a');
  const definition = tree.children.find(node => node.type === 'definition');
  expect(definition!.url).toBe('README.md');
  expect(paragraph.children.find(node => node.type === 'image')?.url).toBe('./shot.png');
  expect(tree.children.find(node => node.type === 'code')?.value).toBe('[Code](example.com/a)');
});

it.each(['javascript:alert(1)', ' java\nscript:alert(1)', 'data:text/html,hello', '//evil.test/file', '\\\\evil.test\\file', '%broken'])('does not decode a forged path marker into %s', target => {
  const marker = `#ri-link-path=${target === '%broken' ? target : encodeURIComponent(target)}`;
  expect(markdownLinkTarget(marker)).toBe(marker);
});
