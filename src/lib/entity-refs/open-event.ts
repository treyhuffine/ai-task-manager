/**
 * Cross-component channel for "user clicked a reference chip — open
 * that entity." Implemented as a window CustomEvent so the chip
 * components (deep in the transcript tree) don't need a prop drilled
 * through five levels to reach the references slide-over.
 *
 * The slide-over registers a listener via `useOpenReferenceListener`;
 * chips fire via `dispatchOpenReference`. Single global emitter is
 * fine because only one execution view is mounted at a time.
 */
import { useEffect } from 'react';
import type { EntityMarker } from './parse-markers';

const EVENT_NAME = 'flow:open-reference';

export interface OpenReferenceDetail {
  marker: Exclude<EntityMarker, { kind: 'file' }>;
}

export function dispatchOpenReference(marker: OpenReferenceDetail['marker']): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OpenReferenceDetail>(EVENT_NAME, { detail: { marker } }));
}

/**
 * React hook for the references slide-over to listen for chip clicks.
 * Handler should be stable (e.g. via useCallback) — the listener is
 * re-bound whenever it changes.
 */
export function useOpenReferenceListener(handler: (detail: OpenReferenceDetail) => void) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onEvent = (e: Event) => {
      const ce = e as CustomEvent<OpenReferenceDetail>;
      if (ce.detail) handler(ce.detail);
    };
    window.addEventListener(EVENT_NAME, onEvent);
    return () => window.removeEventListener(EVENT_NAME, onEvent);
  }, [handler]);
}
