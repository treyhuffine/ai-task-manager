import { expect, it } from 'vitest';
import { filePreviewTarget, isLocalArtifactTarget, replyNamesFile, rewriteLocalArtifacts } from './reply-artifacts';
import { rewriteLocalText, isLocalTextTarget } from './reply-text';

it.each(['[Movie](/tmp/demo.mp4)', '`./clip.webm`', '[Audio](./memo.m4a)', 'Saved /tmp/budget.xlsx.', '[Archive](files.zip)', '[Other](file:///tmp/output.bin)', '[Output](/tmp/no-extension)'])('previews %s', text => { expect(rewriteLocalArtifacts(text, 'chat')).toContain('<ri-file-preview'); expect(rewriteLocalArtifacts(text, null)).toBe(text); });
it.each(['https://example.com/movie.mp4', '[Web](example.com/file.zip)', '[Mail](mailto:a@example.com)', '```\ncat /tmp/private.bin\n```', '`cat /tmp/private.bin`', '[Internal](#section)', '[API](/api/files/demo.mp4)'])('preserves %s', text => { expect(rewriteLocalArtifacts(text, 'chat')).toBe(text); });
it.each(['browser/gallery', 'desktop/mobile', 'unit/backend', 'and/or', 'input/output', 'src/components', 'feature/previews'])('leaves ambiguous slash-separated text %s alone', target => {
  expect(isLocalArtifactTarget(target)).toBe(false);
  for (const text of [target, `Verified ${target} checks.`, `\`${target}\``, `"${target}"`, `[Explicit link](${target})`]) {
    expect(rewriteLocalArtifacts(text, 'chat')).toBe(text);
    expect(replyNamesFile(text, target)).toBe(false);
  }
  expect(filePreviewTarget(`#ri-file=${encodeURIComponent(target)}`)).toBeNull();
});
it.each(['results/output.custom', 'src/.hidden'])('keeps definite file references %s available', target => {
  expect(isLocalArtifactTarget(target)).toBe(true);
  for (const text of [`Saved ${target}.`, `\`${target}\``, `[File](${target})`]) {
    expect(rewriteLocalArtifacts(text, 'chat')).toContain('<ri-file-preview');
    expect(replyNamesFile(text, target)).toBe(true);
  }
});
it.each(['/tmp/no-extension', './build/output', '../build/output', '~/Downloads/output', 'file:///tmp/output', 'docs/README'])('requires an authored link for extensionless paths such as %s', target => {
  for (const text of [`Saved ${target}.`, `\`${target}\``, `"${target}"`]) {
    expect(rewriteLocalArtifacts(text, 'chat')).toBe(text);
    expect(replyNamesFile(text, target)).toBe(false);
  }
  expect(rewriteLocalArtifacts(`[File](${target})`, 'chat')).toContain('<ri-file-preview');
  expect(replyNamesFile(`[File](${target})`, target)).toBe(true);
});
it('checks exact reference boundaries and its own markers', () => {
  expect(replyNamesFile('Open /tmp/movie.mp4.', '/tmp/movie.mp4')).toBe(true);
  for (const text of ['[Backup](/tmp/movie.mp4.bak)', 'https://example.com/tmp/movie.mp4', '```\n/tmp/movie.mp4\n```']) expect(replyNamesFile(text, '/tmp/movie.mp4')).toBe(false);
  expect(filePreviewTarget('#ri-file=%2Ftmp%2Fmovie.mp4')).toBe('/tmp/movie.mp4');
  expect(filePreviewTarget('#ri-file=https%3A%2F%2Fexample.com%2Fa.mp4')).toBeNull();
  expect(isLocalArtifactTarget('//example.com/a.bin')).toBe(false);
});
it.each(['README', 'LICENSE', 'Makefile', 'Dockerfile', '.gitignore', 'src/file.php'])('recognizes %s as text', name => {
  expect(isLocalTextTarget(name)).toBe(true);
  expect(rewriteLocalText(`[Read](${name})`, 'chat')).toContain('<ri-text-preview');
  expect(isLocalTextTarget(`https://example.com/${name}`)).toBe(false);
});
it('lets tables reach their structured preview', () => { expect(rewriteLocalText('[Table](data.csv)', 'chat')).toBe('[Table](data.csv)'); });
