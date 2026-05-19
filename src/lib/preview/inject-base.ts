/**
 * Streaming HTML transform that inserts a `<base href>` tag near the
 * start of the document.
 *
 * Why: when we proxy a dev server at `/preview/<id>/`, the dev server
 * thinks it lives at `/`. Its emitted HTML uses relative URLs like
 * `./style.css` or `images/foo.png`. Without a base tag, the browser
 * resolves those against the iframe's actual URL — close, but
 * frequently wrong (e.g. when the user navigates to a sub-route).
 * A `<base>` tag pins the resolution origin and the URLs just work.
 *
 * Root-absolute paths like `/_next/static/...` aren't fixed by this —
 * the base tag doesn't affect them. Those need the dev server to be
 * configured with a matching base path (`basePath`, `--base`, etc.),
 * documented in the spec.
 *
 * Strategy:
 *   - Best-effort placement, in order of quality:
 *       1. Immediately after `<head ...>` (ideal — semantic + standard).
 *       2. Immediately after `<html ...>` (browser parser hoists into <head>).
 *       3. Immediately after `<!DOCTYPE ...>` (parser still resolves correctly).
 *       4. At the very start of the body if no DOCTYPE or HTML elements
 *          appear within the search budget — usually means a fragment,
 *          which the parent <base> should handle anyway.
 *   - Streams without buffering the whole document: we hold back ~4 KiB
 *     while waiting for a tag to complete on the next chunk, and flush
 *     the rest as we see it. After injection, transparent passthrough.
 *   - Budgeted: gives up after `INJECT_BUDGET_BYTES` of HTML to keep
 *     time-to-first-byte fast for huge documents.
 */

const TEXT_ENCODER = new TextEncoder();

const INJECT_BUDGET_BYTES = 64 * 1024;
/** How many tail bytes we hold back per chunk waiting for a tag to complete. */
const TAIL_WINDOW = 4 * 1024;

function asciiLower(b: number): number {
  return b >= 0x41 && b <= 0x5a ? b + 32 : b;
}

/**
 * Case-insensitive ASCII substring search. Returns the start index of
 * the match in `haystack`, or -1 if no match. `needle` MUST be pre-
 * lowercased ASCII.
 */
function indexOfAsciiCI(haystack: Uint8Array, needle: Uint8Array, fromIndex = 0): number {
  if (needle.length === 0) return fromIndex;
  outer: for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (asciiLower(haystack[i + j]) !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const HEAD_OPEN = TEXT_ENCODER.encode('<head');
const HTML_OPEN = TEXT_ENCODER.encode('<html');
const DOCTYPE = TEXT_ENCODER.encode('<!doctype');
const CLOSE_BRACKET = '>'.charCodeAt(0);

/**
 * Find the byte index *after* an open tag's `>`, given the tag's name
 * was found starting at `tagStart`. Returns -1 if the close bracket
 * isn't in the buffer yet OR if the open tag is unusually long
 * (caps at `maxTagLen` to avoid runaway scans on broken input).
 */
function findEndOfOpenTag(buf: Uint8Array, tagStart: number, maxTagLen: number): number {
  for (let i = tagStart; i < buf.length && i - tagStart < maxTagLen; i++) {
    if (buf[i] === CLOSE_BRACKET) return i + 1;
  }
  return -1;
}

/**
 * Build a Web `TransformStream` that injects `<base href={baseHref}>`
 * once, near the top of the document.
 */
export function createBaseTagInjector(baseHref: string): TransformStream<Uint8Array, Uint8Array> {
  // The href is server-built — sanitize defense-in-depth.
  const safeHref = baseHref.replace(/"/g, '&quot;');
  const injection = TEXT_ENCODER.encode(`<base href="${safeHref}">`);

  // Total bytes seen so far (used for budget enforcement).
  let consumed = 0;
  // Bytes held back at the tail of the most recent emission, waiting
  // for a tag that may complete on the next chunk.
  let pending = new Uint8Array(0);
  // Once true, we're done — passthrough everything.
  let injected = false;

  /**
   * Try every placement strategy from best to worst against `buf` and
   * return the byte index to insert at, or -1 if no candidate is
   * currently available. `allowFallbacks` permits the weaker placements
   * only when we're running out of budget or the stream is ending.
   */
  function findInsertPoint(buf: Uint8Array, allowFallbacks: boolean): number {
    const headStart = indexOfAsciiCI(buf, HEAD_OPEN);
    if (headStart >= 0) {
      const end = findEndOfOpenTag(buf, headStart, 4 * 1024);
      if (end >= 0) return end;
      // Tag's close bracket isn't in the buffer yet — wait.
      return -1;
    }
    if (!allowFallbacks) return -1;

    const htmlStart = indexOfAsciiCI(buf, HTML_OPEN);
    if (htmlStart >= 0) {
      const end = findEndOfOpenTag(buf, htmlStart, 4 * 1024);
      if (end >= 0) return end;
    }

    const doctypeStart = indexOfAsciiCI(buf, DOCTYPE);
    if (doctypeStart >= 0) {
      const end = findEndOfOpenTag(buf, doctypeStart, 256);
      if (end >= 0) return end;
    }

    // Nothing structural to anchor to — likely an HTML fragment
    // (htmx response, mislabeled non-HTML, etc.). Decline to inject
    // rather than splice a tag into ambiguous content.
    return -1;
  }

  function emit(controller: TransformStreamDefaultController<Uint8Array>, buf: Uint8Array, insertAt: number) {
    if (insertAt > 0) controller.enqueue(buf.subarray(0, insertAt));
    controller.enqueue(injection);
    if (insertAt < buf.length) controller.enqueue(buf.subarray(insertAt));
    injected = true;
    pending = new Uint8Array(0);
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (injected) {
        // Passthrough — also coerce strings just in case the upstream
        // emits them.
        controller.enqueue(chunk instanceof Uint8Array ? chunk : TEXT_ENCODER.encode(String(chunk)));
        return;
      }

      const incoming =
        chunk instanceof Uint8Array ? chunk : TEXT_ENCODER.encode(String(chunk));
      consumed += incoming.length;

      const buf = new Uint8Array(pending.length + incoming.length);
      buf.set(pending, 0);
      buf.set(incoming, pending.length);

      // First, try the best placement (head only). If it's there, use it.
      let insertAt = findInsertPoint(buf, false);
      if (insertAt >= 0) {
        emit(controller, buf, insertAt);
        return;
      }

      // If we've burned through the budget, accept whatever fallback
      // we can find (or give up entirely).
      if (consumed >= INJECT_BUDGET_BYTES) {
        insertAt = findInsertPoint(buf, true);
        if (insertAt >= 0) {
          emit(controller, buf, insertAt);
        } else {
          controller.enqueue(buf);
          injected = true; // give up; passthrough mode
          pending = new Uint8Array(0);
        }
        return;
      }

      // Still searching. Flush everything except a small tail window
      // so a partial tag at the boundary can complete on the next chunk.
      const tail = Math.min(TAIL_WINDOW, buf.length);
      const flushUntil = buf.length - tail;
      if (flushUntil > 0) controller.enqueue(buf.subarray(0, flushUntil));
      pending = buf.subarray(flushUntil);
    },

    flush(controller) {
      if (injected) {
        if (pending.length > 0) controller.enqueue(pending);
        return;
      }
      // Stream ended with no `<head>`. Take the best fallback we can.
      const insertAt = findInsertPoint(pending, true);
      if (insertAt >= 0) {
        if (insertAt > 0) controller.enqueue(pending.subarray(0, insertAt));
        controller.enqueue(injection);
        if (insertAt < pending.length) controller.enqueue(pending.subarray(insertAt));
      } else if (pending.length > 0) {
        controller.enqueue(pending);
      }
      injected = true;
    },
  });
}
