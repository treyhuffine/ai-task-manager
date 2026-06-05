'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Transcript density preference.
 *
 *   - `condensed` (default) — completed turns collapse their intermediate
 *     activity (thinking, tool calls, transient assistant messages) into a
 *     single summary row; the live turn streams inline and the final reply
 *     stays visible. Conductor-style.
 *   - `full` — every event renders as its own row (the original feed).
 *
 * Per-origin in localStorage, mirroring `editor-preference.ts` so a laptop
 * and a host machine can differ. A custom event keeps multiple mounts of
 * the transcript (and the Settings panel) in sync within a tab; the native
 * `storage` event covers cross-tab.
 */

export type TranscriptDensity = 'condensed' | 'full';

export const TRANSCRIPT_DENSITY_KEY = 'flow.client.transcriptDensity';
export const DEFAULT_TRANSCRIPT_DENSITY: TranscriptDensity = 'condensed';

const CHANGE_EVENT = 'flow:transcript-density-changed';

function read(): TranscriptDensity {
  if (typeof window === 'undefined') return DEFAULT_TRANSCRIPT_DENSITY;
  try {
    const raw = window.localStorage.getItem(TRANSCRIPT_DENSITY_KEY);
    return raw === 'full' || raw === 'condensed' ? raw : DEFAULT_TRANSCRIPT_DENSITY;
  } catch {
    return DEFAULT_TRANSCRIPT_DENSITY;
  }
}

export function useTranscriptDensity(): {
  density: TranscriptDensity;
  setDensity: (next: TranscriptDensity) => void;
  toggle: () => void;
} {
  const [density, setDensityState] = useState<TranscriptDensity>(() => read());

  useEffect(() => {
    const sync = () => setDensityState(read());
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === TRANSCRIPT_DENSITY_KEY || e.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  const setDensity = useCallback((next: TranscriptDensity) => {
    setDensityState(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(TRANSCRIPT_DENSITY_KEY, next);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      /* localStorage can throw in private mode — non-fatal */
    }
  }, []);

  const toggle = useCallback(() => {
    setDensity(read() === 'condensed' ? 'full' : 'condensed');
  }, [setDensity]);

  return { density, setDensity, toggle };
}
