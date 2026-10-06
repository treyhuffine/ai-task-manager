/** Observe the rendered app without coupling desktop to its React state. */
export function observeDesktopTheme(document: Document, report: (theme: 'light' | 'dark') => void) {
  let previous: 'light' | 'dark' | undefined;
  let observer: MutationObserver | undefined;
  const update = () => {
    const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    if (theme !== previous) { previous = theme; report(theme); }
  };
  const start = () => {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    update();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  return () => { document.removeEventListener('DOMContentLoaded', start); observer?.disconnect(); };
}
