/** Display a filename separately from an image's descriptive alt text. */
export function artifactImageName(src: string, alt?: string): string {
  if (/^(data|blob):/.test(src)) return alt || 'Image';
  try {
    const url = new URL(src, 'http://ri.local');
    const replyImage = url.pathname.endsWith('/reply-image');
    const target = replyImage ? url.searchParams.get('path') : url.pathname;
    const name = target?.split('/').at(-1);
    if (name) {
      // Search params already decoded ordinary paths. Literal percent signs
      // in filenames must survive, while file URL names still need decoding.
      if (replyImage && !target?.startsWith('file://')) return name;
      try { return decodeURIComponent(name); } catch { return name; }
    }
  } catch { /* Non-URL image sources use their description. */ }
  return alt || 'Image';
}

export function protectedImageUrl(src: string): boolean {
  return /^\/api\/(?:attachments\/[^/?]+|sessions\/[^/]+\/reply-image)(?:\?|$)/.test(src);
}

export function imageThumbnailUrl(src: string): string {
  if (!protectedImageUrl(src)) return src;
  return `${src}${src.includes('?') ? '&' : '?'}thumbnail=1`;
}
