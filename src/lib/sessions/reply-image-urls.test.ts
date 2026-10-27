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

  it('leaves web, data and app URLs, and non-images alone', () => {
    const untouched = [
      '![x](https://example.com/a.png)',
      '![x](data:image/png;base64,AAAA)',
      '![x](/api/attachments/01abc.png)',
      '![x](//cdn.example.com/a.png)',
      '[a link](https://example.com/a.png)',
      '[Web image](https://example.com/a.png?download=1)',
      '[Web image](www.example.com/a.png)',
      'www.example.com/a.png and example.com/a.png',
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

  it('turns ordinary image file links into previews, including the reported path', () => {
    const target = '/Users/agent/ai-task-manager/.work/notification-settings-qa/off-desktop.png';
    expect(rewriteLocalImages(`[off-desktop.png](${target})`, SID)).toBe(`![off-desktop.png](${url(target)})`);
    expect(rewriteLocalImages('[Screen shot](</tmp/Screen Shot (1).png> "Desktop")', SID)).toBe(`![Screen shot](${url('/tmp/Screen Shot (1).png')} "Desktop")`);
    expect(rewriteLocalImages('[**Desktop** screenshot](/tmp/shot(1).png)', SID)).toBe(`![Desktop screenshot](${url('/tmp/shot(1).png')})`);
  });

  it('shows paths written in backticks, including spaces and multiple-backtick spans', () => {
    for (const target of ['/tmp/shot.png', '~/Desktop/Screen Shot.png', './screenshots/desktop.webp', 'file:///Users/agent/shot.png']) {
      expect(rewriteLocalImages(`Here: \`${target}\``, SID)).toBe(`Here: ![${target.split('/').at(-1)}](${url(target)})`);
    }
    expect(rewriteLocalImages('``/tmp/shot.png``', SID)).toBe(`![shot.png](${url('/tmp/shot.png')})`);
    expect(rewriteLocalImages('Run `cat /tmp/shot.png`.', SID)).toBe('Run `cat /tmp/shot.png`.');
  });

  it('shows bare and quoted image paths without losing surrounding prose', () => {
    const image = `![shot.png](${url('/tmp/shot.png')})`;
    expect(rewriteLocalImages('Here: /tmp/shot.png, then continue.', SID)).toBe(`Here: ${image}, then continue.`);
    expect(rewriteLocalImages('See (/tmp/shot.png).', SID)).toBe(`See (${image}).`);
    expect(rewriteLocalImages('Here: "/tmp/shot.png" or \'/tmp/shot.png\'.', SID)).toBe(`Here: ${image} or ${image}.`);
    expect(rewriteLocalImages('"/tmp/Screen Shot.png"', SID)).toBe(`![Screen Shot.png](${url('/tmp/Screen Shot.png')})`);
    expect(rewriteLocalImages('screenshots/shot.png and ./out/other.jpg', SID)).toBe(`![shot.png](${url('screenshots/shot.png')}) and ![other.jpg](${url('./out/other.jpg')})`);
  });

  it('preserves code blocks, filenames in prose, and paths inside web links', () => {
    const untouched = [
      '```sh\ncat /tmp/shot.png\n```',
      '~~~md\n[shot](/tmp/shot.png)\n~~~',
      '````md\n```\n/tmp/shot.png\n```\n````',
      '    /tmp/shot.png\n    ![x](/tmp/shot.png)',
      'Saved shot.png and shot.png.bak.',
      '`shot.png`',
      '/tmp/shot.png.bak and /tmp/shot.png/notes.txt',
      'https://example.com/tmp/shot.png and //cdn.example.com/shot.png',
      '[/tmp/shot.png](https://example.com)',
      '![See /tmp/shot.png](https://example.com/other.png)',
      '[[file:shot.png]]',
    ];
    for (const md of untouched) expect(rewriteLocalImages(md, SID)).toBe(md);
  });

  it('handles reference links and images while retaining their definitions', () => {
    expect(rewriteLocalImages('[Desktop][shot]\n\n[shot]: /tmp/shot.png "Desktop"', SID)).toBe(`![Desktop](${url('/tmp/shot.png')} "Desktop")\n\n[shot]: /tmp/shot.png "Desktop"`);
    expect(rewriteLocalImages('![Desktop][shot]\n\n[shot]: /tmp/shot.png', SID)).toBe(`![Desktop](${url('/tmp/shot.png')})\n\n[shot]: /tmp/shot.png`);
  });

  it('retains lists, headings and other Markdown around multiple previews', () => {
    const md = '# Screenshots\n\n- [One](/tmp/one.png)\n- `/tmp/two.png`\n\n**Done**. [[task:abc]]';
    expect(rewriteLocalImages(md, SID)).toBe(`# Screenshots\n\n- ![One](${url('/tmp/one.png')})\n- ![two.png](${url('/tmp/two.png')})\n\n**Done**. [[task:abc]]`);
    const rewritten = rewriteLocalImages(md, SID);
    expect(rewriteLocalImages(rewritten, SID)).toBe(rewritten);
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
