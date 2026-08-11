/**
 * Serialised, self-batching stdin for a terminal.
 *
 * Solves two problems with the obvious `onData -> void post(data)` wiring.
 *
 * **Ordering.** Firing each keystroke as its own un-awaited POST lets the
 * browser run several concurrently, and nothing guarantees they reach the
 * PTY in the order they were typed. Type fast enough and characters
 * transpose. Only one request is ever in flight here, so byte order is the
 * order they were pressed.
 *
 * **Request count.** One HTTP request per character is 363 bytes of headers
 * and a full round trip to deliver one byte. Over a tunnel that is the
 * difference between usable and unusable: measured on a 20-character
 * command, 20 separate POSTs took 54.3s where a single batched POST took
 * 1.3s.
 *
 * The batching is deliberately *adaptive* rather than a fixed timer. A
 * debounce would tax every keystroke with its window even when the link is
 * fast. Instead the first byte goes out immediately and anything typed
 * while that request is in flight coalesces into the next one. On localhost
 * the queue never fills and each keystroke ships alone at full speed; on a
 * slow link the in-flight window widens on its own and a burst collapses
 * into a single request. The transport's own latency is the only tuning
 * parameter, and it needs no configuration.
 *
 * Carries over unchanged if the transport moves from POST to a WebSocket —
 * `send` is just "hand these bytes to the PTY and tell me when it's safe to
 * send more".
 */

export interface InputQueue {
  /** Enqueue bytes for the PTY. Never throws, never blocks. */
  push: (data: string) => void;
  /** Drop anything not yet sent. Called when the terminal goes away. */
  dispose: () => void;
}

export interface InputQueueOptions {
  /**
   * Delivers bytes to the PTY. Resolution gates the next flush, so a
   * transport that resolves early (fire-and-forget) simply batches less.
   */
  send: (data: string) => Promise<unknown>;
  /**
   * Reports a failed flush. The bytes are already gone by then — a
   * terminal has no way to replay a keystroke without risking a double
   * send, so a dropped write is surfaced rather than retried.
   */
  onError?: (err: unknown) => void;
}

export function createInputQueue({ send, onError }: InputQueueOptions): InputQueue {
  let pending = '';
  let draining = false;
  let disposed = false;

  async function drain(): Promise<void> {
    draining = true;
    try {
      // Re-check after every await: more keystrokes almost certainly
      // arrived while the last request was open, and they're what this
      // loop exists to coalesce.
      while (pending && !disposed) {
        const batch = pending;
        pending = '';
        try {
          await send(batch);
        } catch (err) {
          onError?.(err);
        }
      }
    } finally {
      draining = false;
    }
  }

  return {
    push(data: string) {
      if (disposed || !data) return;
      pending += data;
      if (!draining) void drain();
    },
    dispose() {
      disposed = true;
      pending = '';
    },
  };
}
