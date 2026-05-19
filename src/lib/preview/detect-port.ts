/**
 * Framework-agnostic port discovery from a dev server's stdout/stderr.
 *
 * Every popular dev server prints its bound address shortly after start —
 * Next, Vite, Astro, Remix, Flask, Rails, Phoenix, axum, Storybook,
 * `python -m http.server`, you name it. They differ in prose but share
 * the same essential fragment: a localhost host + port. We match the
 * fragment with one regex and ignore the rest of the banner.
 *
 * The detector is a stateful line consumer: feed it chunks (which may
 * split lines anywhere), and call `port()` to see if it's found one yet.
 * It also exposes `feedAndCheck()` for the supervisor's hot path, which
 * returns the port the *moment* it appears so the supervisor can flip
 * `status` to `running` and notify subscribers without an extra poll.
 *
 * Constraints:
 *   - Only matches ports in the unprivileged range (1024–65535). Avoids
 *     false positives like `version 9.0.1` or git short SHAs that happen
 *     to be all digits.
 *   - Skips ports that match the host's HTTP/HTTPS proxy ports
 *     (the Flow server itself, the Portless daemon, etc. — set via the
 *     `ignorePorts` option) so the detector doesn't latch onto an
 *     `Auto-restart at http://localhost:4224` line from the framework's
 *     own banner re-print.
 *   - Anchors on a host token so random `:3000` mentions don't trigger.
 */

const HOST_PORT_RE =
  /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|::1)[:](\d{4,5})\b/gi;

const MIN_PORT = 1024;
const MAX_PORT = 65535;

export interface DetectPortOptions {
  /** Ports the matcher should pretend not to see. */
  ignorePorts?: ReadonlySet<number>;
}

export class PortDetector {
  private buffer = '';
  private resolved: number | null = null;
  private readonly ignore: ReadonlySet<number>;

  constructor(options: DetectPortOptions = {}) {
    this.ignore = options.ignorePorts ?? new Set<number>();
  }

  /**
   * Feed a chunk (string or Buffer) and return the port the moment it
   * appears, or null otherwise. Subsequent chunks are still buffered
   * but the detector short-circuits once `resolved` is set.
   */
  feedAndCheck(chunk: string | Uint8Array): number | null {
    if (this.resolved !== null) return null;

    const text =
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

    // Append, then scan the suffix. Cap the buffer so a chatty stderr
    // (e.g. `node --inspect`'s preamble) doesn't grow it unboundedly.
    this.buffer += text;
    if (this.buffer.length > 64 * 1024) {
      this.buffer = this.buffer.slice(-32 * 1024);
    }

    HOST_PORT_RE.lastIndex = 0;
    for (const match of this.buffer.matchAll(HOST_PORT_RE)) {
      const port = Number(match[1]);
      if (!Number.isInteger(port)) continue;
      if (port < MIN_PORT || port > MAX_PORT) continue;
      if (this.ignore.has(port)) continue;
      this.resolved = port;
      this.buffer = ''; // free the buffer once we've locked in
      return port;
    }

    return null;
  }

  /** Current port if known, else null. Idempotent. */
  port(): number | null {
    return this.resolved;
  }

  /** Force a port — used by the supervisor when the user pinned an override. */
  set(port: number): void {
    this.resolved = port;
    this.buffer = '';
  }

  /** Wipe all state. Used between process restarts in the same supervisor slot. */
  reset(): void {
    this.resolved = null;
    this.buffer = '';
  }
}

// Re-export of the regex so tests can sanity-check sample banners
// without instantiating a detector.
export const HOST_PORT_REGEX = HOST_PORT_RE;
