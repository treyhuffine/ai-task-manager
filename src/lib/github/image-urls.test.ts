import { describe, expect, it } from 'vitest';
import { githubImageLink, githubImageSource } from './image-urls';

const SHA = 'c5d8ea2ecf8587bc5ae8d570fe96f5220e25cf36';
const REPORTED = `https://github.com/InsiderFinance/insiderfinance-app/blob/${SHA}/459/after-overview.jpg?raw=true`;

describe('githubImageSource', () => {
  it('reads the documented blob form, the one that renders on a pull request page', () => {
    expect(githubImageSource(REPORTED)).toEqual({
      owner: 'InsiderFinance',
      repo: 'insiderfinance-app',
      rest: `${SHA}/459/after-overview.jpg`,
      fetchUrl: `https://raw.githubusercontent.com/InsiderFinance/insiderfinance-app/${SHA}/459/after-overview.jpg`,
      pageUrl: `https://github.com/InsiderFinance/insiderfinance-app/blob/${SHA}/459/after-overview.jpg`,
      name: 'after-overview.jpg',
      immutable: true,
      raw: true,
    });
  });

  it('reads every form GitHub serves a repository file under', () => {
    const fetchUrl = 'https://raw.githubusercontent.com/o/r/main/docs/a.png';
    for (const url of [
      'https://github.com/o/r/blob/main/docs/a.png',
      'https://github.com/o/r/blob/main/docs/a.png?raw=1',
      'https://github.com/o/r/raw/main/docs/a.png',
      'https://www.github.com/o/r/blob/main/docs/a.png',
      'http://github.com/o/r/blob/main/docs/a.png',
      'https://raw.githubusercontent.com/o/r/main/docs/a.png',
      'https://raw.githubusercontent.com/o/r/main/docs/a.png?token=ABC',
      'https://RAW.githubusercontent.com/o/r/main/docs/a.png#top',
    ]) {
      expect(githubImageSource(url), url).toMatchObject({ owner: 'o', repo: 'r', fetchUrl, pageUrl: 'https://github.com/o/r/blob/main/docs/a.png', name: 'a.png', immutable: false });
    }
    expect(githubImageSource('https://raw.githubusercontent.com/o/r/refs/heads/feature/x/shots/b.webp')).toMatchObject({
      rest: 'refs/heads/feature/x/shots/b.webp',
      fetchUrl: 'https://raw.githubusercontent.com/o/r/refs/heads/feature/x/shots/b.webp',
      name: 'b.webp',
    });
  });

  it('keeps the path as written for GitHub to resolve, and decodes only the display name', () => {
    const source = githubImageSource('https://github.com/o/r/blob/main/Screen%20Shot%20%281%29.png?raw=true');
    expect(source?.fetchUrl).toBe('https://raw.githubusercontent.com/o/r/main/Screen%20Shot%20%281%29.png');
    expect(source?.name).toBe('Screen Shot (1).png');
  });

  it('knows a page from the bytes', () => {
    expect(githubImageSource('https://github.com/o/r/blob/main/a.png')?.raw).toBe(false);
    expect(githubImageSource('https://github.com/o/r/blob/main/a.png?raw=true')?.raw).toBe(true);
    expect(githubImageSource('https://github.com/o/r/raw/main/a.png')?.raw).toBe(true);
    expect(githubImageSource('https://raw.githubusercontent.com/o/r/main/a.png')?.raw).toBe(true);
  });

  it('treats only a full commit hash as final', () => {
    expect(githubImageSource(`https://github.com/o/r/blob/${SHA}/a.png`)?.immutable).toBe(true);
    expect(githubImageSource(`https://github.com/o/r/blob/${SHA.toUpperCase()}/a.png`)?.immutable).toBe(true);
    expect(githubImageSource(`https://github.com/o/r/blob/${'a'.repeat(64)}/a.png`)?.immutable).toBe(true);
    expect(githubImageSource(`https://github.com/o/r/blob/${SHA.slice(0, 7)}/a.png`)?.immutable).toBe(false);
    expect(githubImageSource('https://github.com/o/r/blob/v1.2.0/a.png')?.immutable).toBe(false);
  });

  it('names only GitHub, exactly', () => {
    for (const url of [
      'https://github.com.evil.example/o/r/blob/main/a.png',
      'https://evil.example/github.com/o/r/blob/main/a.png',
      'https://evil.example/o/r/blob/main/a.png?host=github.com',
      'https://raw.githubusercontent.com.evil.example/o/r/main/a.png',
      'https://notraw.githubusercontent.com/o/r/main/a.png',
      'https://gist.githubusercontent.com/o/abc/raw/a.png',
      'https://user-images.githubusercontent.com/1/abc.png',
      'https://github.com:8443/o/r/blob/main/a.png',
      'https://user:pass@github.com/o/r/blob/main/a.png',
      'ftp://github.com/o/r/blob/main/a.png',
      'github.com/o/r/blob/main/a.png',
      '//github.com/o/r/blob/main/a.png',
      '/api/sessions/x/reply-image?path=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fblob%2Fmain%2Fa.png',
      'data:image/png;base64,AAAA',
    ]) expect(githubImageSource(url), url).toBeNull();
  });

  it('names only repository files', () => {
    for (const url of [
      'https://github.com/o/r',
      'https://github.com/o/r/blob/main',
      'https://github.com/o/r/tree/main/docs',
      'https://github.com/o/r/pull/459',
      'https://github.com/o/r/assets/1/abc',
      'https://github.com/user-attachments/assets/abc',
      'https://github.com/o/r/blob//a.png',
      'https://github.com/o/r/blob/main/../a.png',
      'https://github.com/o/../blob/main/a.png',
      'https://github.com/-o/r/blob/main/a.png',
      'https://github.com/o/r%20x/blob/main/a.png',
      'https://raw.githubusercontent.com/o/r/main',
      'https://raw.githubusercontent.com/o',
    ]) expect(githubImageSource(url), url).toBeNull();
  });
});

describe('githubImageLink', () => {
  it('turns only a link to the bytes of an image into a preview', () => {
    expect(githubImageLink('https://raw.githubusercontent.com/o/r/main/a.png')).not.toBeNull();
    expect(githubImageLink('https://github.com/o/r/raw/main/a.JPG')).not.toBeNull();
    expect(githubImageLink('https://github.com/o/r/blob/main/a.webp?raw=true')).not.toBeNull();
    // A page link has more on it than the file.
    expect(githubImageLink('https://github.com/o/r/blob/main/a.png')).toBeNull();
    // Bytes of something other than an image.
    expect(githubImageLink('https://raw.githubusercontent.com/o/r/main/README.md')).toBeNull();
    expect(githubImageLink('https://github.com/o/r/blob/main/report.pdf?raw=true')).toBeNull();
  });
});
