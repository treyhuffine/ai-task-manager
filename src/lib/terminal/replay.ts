/**
 * Deciding what a reconnecting terminal viewer still needs to see.
 *
 * Split out of `pty-manager` so it can be tested without `node-pty`: the
 * manager pulls in a native binding and spawns real shells, and none of
 * that is relevant to the arithmetic below.
 *
 * The model is a bounded ring of recent output plus a monotonic count of
 * everything ever written. Together those give an absolute cursor: the
 * client reports the offset it last processed, and we hand back the slice
 * between there and now. Before this existed every reconnect replayed the
 * whole ring, and the client wrote it into a terminal that already had it —
 * so scrollback quietly doubled every time the stream blipped.
 */

export interface ReplayState {
  /** Recent output, oldest first. */
  chunks: readonly string[];
  /** Characters ever written, including chunks since evicted. */
  emittedChars: number;
  /** Characters currently held in `chunks`. */
  bufferChars: number;
}

export interface ReplaySlice {
  /** Output the caller has not seen yet. */
  replay: string;
  /**
   * True when `since` predates the ring, so `replay` is a recent tail
   * rather than an exact continuation. The viewer has to reset before
   * writing it, otherwise it splices a snapshot onto a hole.
   */
  gap: boolean;
}

/**
 * Output after `since`. Omit `since` for a viewer that has seen nothing,
 * which gets the full buffer.
 */
export function sliceReplay(state: ReplayState, since?: number): ReplaySlice {
  const { chunks, emittedChars, bufferChars } = state;

  // A brand-new viewer, or a cursor we can't trust. Hand over everything
  // held and let it paint from scratch.
  if (since === undefined || !Number.isFinite(since) || since < 0) {
    return { replay: chunks.join(''), gap: false };
  }

  // Already current. This is the common reconnect — the stream dropped and
  // came back before the shell wrote anything — and returning the buffer
  // here is precisely the duplication bug.
  if (since >= emittedChars) {
    return { replay: '', gap: false };
  }

  const bufferStart = emittedChars - bufferChars;

  // Away long enough that what we missed has already been evicted.
  if (since < bufferStart) {
    return { replay: chunks.join(''), gap: true };
  }

  return { replay: chunks.join('').slice(since - bufferStart), gap: false };
}
