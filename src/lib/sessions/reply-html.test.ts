import { describe, expect, it } from 'vitest';
import { htmlPreviewHref, htmlPreviewReference, htmlPreviewTarget, rewriteLocalHtml } from './reply-html';

const path = '/Users/agent/code/ballcoach.ai/work/visualizations/playbank-explorer.html';
const marker = (value: unknown) => `\uE200visualize\uE202${JSON.stringify(value)}\uE201`;
const link = (target = path, label = 'playbank-explorer.html') => htmlPreviewReference(target, label);

describe('HTML reply references', () => {
  it('recognizes the reported visualize marker without changing the original output', () => {
    const original = `Try the filters below.\n\n${marker({ path, mode: 'wide' })}`;
    expect(rewriteLocalHtml(original, 'chat-1')).toBe(`Try the filters below.\n\n${link()}`);
    expect(original).toContain('visualize');
  });

  it('recognizes ordinary links, backticks, bare paths and quoted paths', () => {
    for (const original of [`[Explore](${path})`, `\`${path}\``, path, `"${path}"`]) {
      expect(rewriteLocalHtml(original, 'chat-1')).toBe(original.startsWith('[Explore]') ? link(path, 'Explore') : link());
    }
    expect(rewriteLocalHtml('[Preview](<./Screen Shot.htm>)', 'chat-1')).toBe(link('./Screen Shot.htm', 'Preview'));
  });

  it('preserves prose and other references around a marker in the same paragraph', () => {
    const original = `One ${marker({ path })} then /tmp/second.html and [[task:abc]].`;
    expect(rewriteLocalHtml(original, 'chat-1')).toBe(`One ${link()} then ${link('/tmp/second.html', 'second.html')} and [[task:abc]].`);
  });

  it('leaves incomplete/invalid markers, code and web targets alone', () => {
    const untouched = [
      `\`${marker({ path })}\``,
      `\`\`\`text\n${marker({ path })}\n${path}\n\`\`\``,
      `\uE200visualize\uE202{"path":"${path}",broken}\uE201`,
      marker({ path: 'https://example.com/index.html', mode: 'wide' }),
      '[Website](https://example.com/index.html)',
      '[Website](https://example.com/index.html?view=wide#plays)',
      '[Website](//example.com/index.html)',
      'www.example.com/index.html and example.com/index.html',
      'https://example.com/index.html',
      'Saved index.html.',
      '/tmp/index.html.bak',
    ];
    for (const text of untouched) expect(rewriteLocalHtml(text, 'chat-1')).toBe(text);
  });

  it('does nothing without a chat, and never converts a preview link twice', () => {
    expect(rewriteLocalHtml(marker({ path }), undefined)).toBe(marker({ path }));
    expect(rewriteLocalHtml(link(), 'chat-1')).toBe(link());
  });

  it('decodes only local HTML preview actions', () => {
    expect(htmlPreviewTarget(htmlPreviewHref(path))).toBe(path);
    for (const href of ['#ri-html=%broken', htmlPreviewHref('/etc/hosts'), htmlPreviewHref('https://example.com/a.html'), '#other', undefined]) {
      expect(htmlPreviewTarget(href)).toBeNull();
    }
  });
});
