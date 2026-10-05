/**
 * Images an agent puts in a reply by local path (`![shot](/tmp/shot.png)`,
 * `![](screenshots/home.png)`, `file:///…`, `~/Desktop/x.png`) point at its
 * chat's reply-image route instead, so the browser can load them. Left as is,
 * the browser asks the app's own address for `/tmp/shot.png` and gets nothing,
 * whether the file was in the repo or not.
 *
 * Only images, only local paths: web addresses, `data:` URLs and the app's own
 * `/api/…` routes pass through, and code is left exactly as written. The
 * route decides what it will actually serve (`reply-images.ts`). Pure, so the
 * transcript and tests share it.
 */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|heic|heif|bmp|ico)$/i;

/** `![alt](target "title")` or `![alt](<target with spaces> "title")`. */
const IMAGE_MD = /!\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(\s+"[^"\n]*")?\s*\)/g;

/** Fenced code blocks and inline code, which must never be rewritten. */
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/g;

export function replyImageUrl(sessionId: string, target: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/reply-image?path=${encodeURIComponent(target)}`;
}

/** Whether a markdown image target is a path on the machine, not a URL. */
export function isLocalImageTarget(target: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^file:\/\//i.test(target)) return false; // http:, data:, …
  if (target.startsWith('//') || target.startsWith('/api/') || target.startsWith('#')) return false;
  const path = target.replace(/^file:\/\//i, '').split(/[?#]/)[0] ?? '';
  return IMAGE_EXT.test(path);
}

export function rewriteLocalImages(markdown: string, sessionId: string | null | undefined): string {
  if (!sessionId || !markdown.includes('![')) return markdown;
  return markdown
    .split(CODE)
    .map((part, i) =>
      // split() with a capturing group puts the code spans at odd indexes.
      i % 2 === 1
        ? part
        : part.replace(IMAGE_MD, (whole, alt: string, bracketed: string | undefined, bare: string | undefined, title: string | undefined) => {
            const target = bracketed ?? bare ?? '';
            if (!isLocalImageTarget(target)) return whole;
            return `![${alt}](${replyImageUrl(sessionId, target)}${title ?? ''})`;
          }),
    )
    .join('');
}
