'use client';

import { htmlPreviewDocument } from './html-preview-document';
import { uuidv7 } from 'uuidv7';

/** A short cache key for a bounded source, recalculated only on file edits. */
export function htmlThumbnailVersion(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
  return `${content.length}:${hash >>> 0}`;
}

/** Run the artifact once in an opaque frame, copy its rendered markup, then
 * destroy that frame. The displayed thumbnail contains no runnable scripts.
 * Frames never get Ri's DOM, cookies or storage. */
export function captureHtmlThumbnail(content: string, theme: 'light' | 'dark', signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    const nonce = uuidv7();
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:960px;height:640px;border:0;pointer-events:none';
    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      frame.remove();
    };
    const fail = (message: string) => { cleanup(); reject(new Error(message)); };
    const finish = (html: string) => { cleanup(); resolve(htmlPreviewDocument(html, theme, false)); };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'ri:html-thumbnail' || event.data.nonce !== nonce || typeof event.data.html !== 'string') return;
      if (event.data.html.length > 2 * 1024 * 1024) { fail('Thumbnail is too large'); return; }
      finish(event.data.html);
    };
    const abort = () => { cleanup(); reject(new DOMException('Preview cancelled', 'AbortError')); };
    const timeout = setTimeout(() => fail('Thumbnail timed out'), 2000);
    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    const source = new DOMParser().parseFromString(htmlPreviewDocument(content, theme), 'text/html');
    const capture = source.createElement('script');
    capture.textContent = `(() => {
      let sent = false;
      const capture = () => {
        if (sent) return;
        sent = true;
        document.querySelectorAll('canvas').forEach(canvas => {
          try {
            const image = document.createElement('img');
            image.src = canvas.toDataURL(); image.width = canvas.width; image.height = canvas.height;
            image.style.cssText = canvas.style.cssText; image.className = canvas.className;
            canvas.replaceWith(image);
          } catch { /* Tainted canvases cannot be copied into a thumbnail. */ }
        });
        parent.postMessage({ type: 'ri:html-thumbnail', nonce: ${JSON.stringify(nonce)}, html: document.documentElement.outerHTML }, '*');
      };
      const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(capture, 120)));
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
      setTimeout(capture, 1400);
    })();`;
    source.body.append(capture);
    frame.srcdoc = `<!doctype html>\n${source.documentElement.outerHTML}`;
    document.body.append(frame);
  });
}
