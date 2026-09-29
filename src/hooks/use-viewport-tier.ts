import { useSyncExternalStore } from 'react';

/**
 * Which of the dashboard's layouts the viewport shows, by the same
 * breakpoints as the CSS that hides the others: phone below Tailwind's `md`,
 * tablet from `md` to `lg`, desktop from `lg`.
 *
 * Mounting all three and hiding two with CSS ran everything three times:
 * every live stream, every composer's probes, a hidden main chat. On a
 * plain-HTTP connection those streams alone fill the browser's six
 * connections to the host, and every other request waits behind them.
 * Components render only the layout for the viewport now (gate B finding).
 *
 * Null while rendering on the server and hydrating, where the viewport isn't
 * known. Callers render every layout then, hidden by CSS as before, so the
 * server's HTML is unchanged, and keep only the right one once mounted.
 */
export type ViewportTier = 'phone' | 'tablet' | 'desktop';

const MD = '(min-width: 48rem)';
const LG = '(min-width: 64rem)';

function subscribe(onChange: () => void): () => void {
  const md = window.matchMedia(MD);
  const lg = window.matchMedia(LG);
  md.addEventListener('change', onChange);
  lg.addEventListener('change', onChange);
  return () => {
    md.removeEventListener('change', onChange);
    lg.removeEventListener('change', onChange);
  };
}

function getSnapshot(): ViewportTier {
  if (window.matchMedia(LG).matches) return 'desktop';
  return window.matchMedia(MD).matches ? 'tablet' : 'phone';
}

export function useViewportTier(): ViewportTier | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
