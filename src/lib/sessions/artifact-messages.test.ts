import { expect, it } from 'vitest';
import { messageArtifactPaths } from './artifact-messages';

it('collects authored links, inferred paths, images and reference-style links once', () => {
  expect(messageArtifactPaths('[Report](./out/report.pdf)\n\n![Chart](/tmp/chart.png)\n\n`./out/report.pdf`\n\n[Plan][plan]\n\n[plan]: notes/plan.md\n\nOpen "/tmp/my file.docx".')).toEqual([
    './out/report.pdf', '/tmp/chart.png', 'notes/plan.md', '/tmp/my file.docx',
  ]);
});

it('ignores websites, fenced examples, tool-like paths and ordinary filenames', () => {
  expect(messageArtifactPaths('https://example.com/report.pdf\n\n[Web](https://example.com/tmp/file.csv)\n\n```\n/tmp/example.pdf\n```\n\n`browser/gallery` and `/v1/status`\n\nreport.pdf')).toEqual([]);
});

it('normalizes source line locations and collects visualize documents outside code', () => {
  const marker = '\uE200visualize\uE202{"path":"/tmp/chart.html"}\uE201';
  expect(messageArtifactPaths(`[Source](src/app.tsx:12:4)\n\n${marker}\n\n\`${marker}\``).sort()).toEqual(['/tmp/chart.html', 'src/app.tsx']);
});
