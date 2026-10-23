import { describe, expect, it } from 'vitest';
import { isLocalTextTarget, replyNamesTextFile, rewriteLocalText, textPreviewTarget } from './reply-text';
import { resolveFileReference } from './local-file-references';
import { rewriteLocalImages } from './reply-image-urls';
import { rewriteLocalHtml } from './reply-html';
import { rewriteLocalPdfs } from './reply-pdf';

describe('text files in replies', () => {
  it.each(['[Read the plan](/tmp/plan.md)', '`./src/app.tsx`', 'Saved /tmp/report.txt.', 'Open "./docs/My Notes.markdown"', '[Config](file:///tmp/config.yaml)', '[Readme](README.md)', '[Plan][plan]\n\n[plan]: /tmp/plan.md'])('turns %s into an in-app preview', markdown => {
    expect(rewriteLocalText(markdown, 'chat')).toContain('<ri-text-preview href="#ri-text=');
    expect(rewriteLocalText(markdown, null)).toBe(markdown);
  });
  it.each(['[Website](https://example.com/plan.md)', '[Web](//example.com/plan.md)', '[Web](example.com/plan.md)', 'saved plan.md', '```\ncat /tmp/plan.md\n```', '`cat /tmp/plan.md`', '[Archive](/tmp/files.zip)', '[Picture](/tmp/photo.png)'])('preserves %s', markdown => {
    expect(rewriteLocalText(markdown, 'chat')).toBe(markdown);
  });
  it('decodes only its own local text destinations and escapes link labels', () => {
    expect(textPreviewTarget('#ri-text=%2Ftmp%2FMy%20Notes.md')).toBe('/tmp/My Notes.md');
    for (const href of [undefined, '#ri-text=%broken', '#ri-text=https%3A%2F%2Fexample.com%2Fa.md', '#ri-text=%2Ftmp%2Fphoto.png']) expect(textPreviewTarget(href)).toBeNull();
    expect(isLocalTextTarget('src/app.tsx')).toBe(true);
    expect(rewriteLocalText('[<b>Notes</b> & "more"](/tmp/plan.md)', 'chat')).toContain('&lt;b&gt;Notes&lt;/b&gt; &amp; &quot;more&quot;');
  });
  it('opens the file behind source line locations and document fragments', () => {
    for (const target of ['/tmp/example.ts:12', '/tmp/example.ts:12:4', '/tmp/notes.md#decisions']) {
      const path = target.startsWith('/tmp/example') ? '/tmp/example.ts' : '/tmp/notes.md';
      expect(rewriteLocalText(`[Open](${target})`, 'chat')).toContain(encodeURIComponent(path));
      expect(replyNamesTextFile(`[Open](${target})`, path)).toBe(true);
    }
  });
  it('resolves a rendered document own links and images relative to its directory', () => {
    const base = '/tmp/docs/review.md';
    expect(resolveFileReference('../next.md', base)).toBe('/tmp/next.md');
    expect(resolveFileReference('./next.md', 'docs/review.md')).toBe('docs/next.md');
    expect(resolveFileReference('next.md', 'file:///tmp/docs/review.md')).toBe('file:///tmp/docs/next.md');
    expect(resolveFileReference('https://example.com/next.md', base)).toBe('https://example.com/next.md');
    expect(rewriteLocalText('[Next](../next.md)', 'chat', base)).toContain(encodeURIComponent('/tmp/next.md'));
    expect(rewriteLocalImages('![Shot](./shot.png)', 'chat', base)).toContain(encodeURIComponent('/tmp/docs/shot.png'));
    expect(rewriteLocalHtml('[Report](./report.html)', 'chat', base)).toContain(encodeURIComponent('/tmp/docs/report.html'));
    expect(rewriteLocalPdfs('[Report](./report.pdf)', 'chat', base)).toContain(encodeURIComponent('/tmp/docs/report.pdf'));
  });
  it('requires an exact file reference, with no grant from a longer path, web URL, or code example', () => {
    const path = '/tmp/notes.md';
    for (const text of [`Open ${path}`, `[Notes](${path})`, `\`${path}\``, `"${path}"`]) expect(replyNamesTextFile(text, path)).toBe(true);
    for (const text of [`Open ${path}.bak`, `[Backup](${path}.bak)`, `\`${path}.bak\``, `https://example.com${path}`, `\`cat ${path}\``, `\`\`\`\ncat ${path}\n\`\`\``]) expect(replyNamesTextFile(text, path)).toBe(false);
  });
});
