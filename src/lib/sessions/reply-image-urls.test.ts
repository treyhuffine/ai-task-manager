import { describe, expect, it } from 'vitest';
import { isLocalImageTarget, replyImageUrl, rewriteLocalImages } from './reply-image-urls';

const SID = 'chat-1';
const url = (p: string) => replyImageUrl(SID, p);

describe('rewriteLocalImages', () => {
  it('points every local image path at the chat route', () => {
    for (const target of ['/tmp/ri/shots/home.png', 'screenshots/home.png', './out/a.jpg', '../x.webp', '~/Desktop/Screen Shot.png', 'file:///Users/agent/x.png']) {
      const md = target.includes(' ') ? `![shot](<${target}>)` : `![shot](${target})`;
      expect(rewriteLocalImages(md, SID)).toBe(`![shot](${url(target)})`);
    }
  });

  it('keeps the title and the text around it', () => {
    expect(rewriteLocalImages('Before ![a](/tmp/a.png "The board") after', SID)).toBe(`Before ![a](${url('/tmp/a.png')} "The board") after`);
  });

  it('leaves web, data and app URLs, links, and non-images alone', () => {
    const untouched = [
      '![x](https://example.com/a.png)',
      '![x](data:image/png;base64,AAAA)',
      '![x](/api/attachments/01abc.png)',
      '![x](//cdn.example.com/a.png)',
      '[a link](/tmp/a.png)',
      '![log](/tmp/run.log)',
      'no images here',
    ];
    for (const md of untouched) expect(rewriteLocalImages(md, SID)).toBe(md);
  });

  it('never rewrites inside code', () => {
    const md = 'Use `![x](/tmp/a.png)` like this:\n\n```md\n![x](/tmp/a.png)\n```\n\nand ![x](/tmp/a.png)';
    expect(rewriteLocalImages(md, SID)).toBe(`Use \`![x](/tmp/a.png)\` like this:\n\n\`\`\`md\n![x](/tmp/a.png)\n\`\`\`\n\nand ![x](${url('/tmp/a.png')})`);
  });

  it('does nothing without a chat to ask', () => {
    expect(rewriteLocalImages('![x](/tmp/a.png)', null)).toBe('![x](/tmp/a.png)');
  });
});

describe('isLocalImageTarget', () => {
  it('knows paths from URLs', () => {
    expect(isLocalImageTarget('/Users/agent/shot.PNG')).toBe(true);
    expect(isLocalImageTarget('C.png')).toBe(true);
    expect(isLocalImageTarget('http://localhost:3000/a.png')).toBe(false);
    expect(isLocalImageTarget('mailto:a@b.png')).toBe(false);
  });
});
