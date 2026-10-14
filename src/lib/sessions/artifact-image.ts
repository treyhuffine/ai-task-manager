import { githubImageSource } from '@/lib/github/image-urls';

/** The address a reply-image route serves, when `src` is one. Decoded by the URL parser. */
function replyImageTarget(src: string): string | null {
  try {
    const url = new URL(src, 'http://ri.local');
    return url.pathname.endsWith('/reply-image') ? url.searchParams.get('path') : null;
  } catch {
    return null;
  }
}

/** Display a filename separately from an image's descriptive alt text. */
export function artifactImageName(src: string, alt?: string): string {
  if (/^(data|blob):/.test(src)) return alt || 'Image';
  const target = replyImageTarget(src);
  const github = githubImageSource(target ?? src);
  if (github) return github.name;
  try {
    const url = new URL(src, 'http://ri.local');
    const pathname = target ?? url.pathname;
    const name = pathname.split('/').at(-1);
    if (name) {
      // Search params already decoded ordinary paths. Literal percent signs
      // in filenames must survive, while file URL names still need decoding.
      if (target && !target.startsWith('file://')) return name;
      try { return decodeURIComponent(name); } catch { return name; }
    }
  } catch { /* Non-URL image sources use their description. */ }
  return alt || 'Image';
}

export interface ImageFallback {
  href: string;
  label: string;
}

/**
 * Where an image can still be seen when its preview cannot load: the file's
 * page on GitHub, which a signed-in browser can open, or the web address
 * itself. A local file has no such place.
 */
export function artifactImageFallback(src: string): ImageFallback | null {
  const target = replyImageTarget(src);
  const github = githubImageSource(target ?? src);
  if (github) return { href: github.pageUrl, label: 'Open on GitHub' };
  if (!target && /^https?:\/\//i.test(src)) return { href: src, label: 'Open image' };
  return null;
}

export function protectedImageUrl(src: string): boolean {
  return /^\/api\/(?:attachments\/[^/?]+|sessions\/[^/]+\/reply-image)(?:\?|$)/.test(src);
}

export function imageThumbnailUrl(src: string): string {
  if (!protectedImageUrl(src)) return src;
  return `${src}${src.includes('?') ? '&' : '?'}thumbnail=1`;
}
