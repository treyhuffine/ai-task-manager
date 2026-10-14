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

/** The source the agent supplied, rather than our thumbnail or blob URL. */
export function artifactImageSource(src: string): string {
  if (src.startsWith('data:')) return 'Embedded image (data URL)';
  if (src.startsWith('blob:')) return 'Temporary image (blob URL)';
  if (!protectedImageUrl(src)) return src;
  try {
    const url = new URL(src, 'http://ri.local');
    if (url.pathname.endsWith('/reply-image')) return url.searchParams.get('path') || src;
  } catch { /* Keep an unfamiliar source as written. */ }
  return src;
}

/** Preserve an image route's explanation without showing an HTML error page. */
export async function imageResponseError(response: Response): Promise<string> {
  const status = `HTTP ${response.status}`;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const { error, message } = body as { error?: unknown; message?: unknown };
      const detail = typeof message === 'string' ? message : typeof error === 'string' ? error : '';
      if (detail.trim()) return `${status}: ${detail}`;
    }
  } catch { /* Proxies and auth pages may return HTML or no body. */ }
  return status;
}
