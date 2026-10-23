import { HOTKEYS, matchesHotkey } from '@/constants/commands';

/** The slice of the Navigation API used here. TypeScript's DOM lib doesn't carry it yet. */
export interface NavigationLike extends EventTarget {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

export function navigation(): NavigationLike | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { navigation?: NavigationLike }).navigation ?? null;
}

export function goBack(): void {
  if (navigation()?.canGoBack === false) return;
  window.history.back();
}

export function goForward(): void {
  if (navigation()?.canGoForward === false) return;
  window.history.forward();
}

/**
 * Whether a Back or Forward key press belongs to something else. As in a
 * browser, ⌘[ and ⌘] work from a text field or the chat composer (Home
 * focuses it, so anything stricter would never fire there). They stay out
 * of the places the keys mean something:
 *
 *   - a handler already took the key (`defaultPrevented`),
 *   - the terminal, where ⌃[ is Escape,
 *   - a code editor, where ⌘[ and ⌘] outdent and indent,
 *   - ⌃[ on a Mac, which is Escape to anyone with vim habits. `matchesHotkey`
 *     treats Ctrl as Cmd, so the Mac check asks for the real ⌘.
 */
export function navigationKeyBlocked(event: KeyboardEvent, platform: string): boolean {
  if (event.defaultPrevented) return true;
  if (platform === 'darwin' && !event.metaKey) return true;
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest('.xterm, .cm-editor');
}


/** Viewer-only navigation. It exposes no desktop or service capabilities. */
export function installHistoryNavigation(platform: string): () => void {
  const keydown = (event: KeyboardEvent) => {
    if (navigationKeyBlocked(event, platform)) return;
    if (matchesHotkey(event, HOTKEYS.navigateBack)) { event.preventDefault(); goBack(); }
    else if (matchesHotkey(event, HOTKEYS.navigateForward)) { event.preventDefault(); goForward(); }
  };
  const mouseup = (event: MouseEvent) => {
    if (event.button === 3) { event.preventDefault(); goBack(); }
    else if (event.button === 4) { event.preventDefault(); goForward(); }
  };
  const menu = (event: Event) => { if ((event as CustomEvent).detail === 'back') goBack(); else if ((event as CustomEvent).detail === 'forward') goForward(); };
  window.addEventListener('keydown', keydown); window.addEventListener('mouseup', mouseup); window.addEventListener('ri-history-navigation', menu);
  return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('mouseup', mouseup); window.removeEventListener('ri-history-navigation', menu); };
}
