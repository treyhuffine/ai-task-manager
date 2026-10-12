/** Opaque-origin frames can run the artifact's scripts without Ri's cookies,
 * storage or DOM. Standalone HTML can load HTTPS assets, but cannot call APIs,
 * submit forms, nest frames or navigate the containing page. */
export const HTML_PREVIEW_SANDBOX = 'allow-scripts';
export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  'img-src data: blob: https:',
  'font-src data: https:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// Visualize artifacts leave variant navigation to their host. Provide that
// small part of the host here, preserving each variant's live DOM and state.
const VARIANT_NAVIGATION = `
document.querySelectorAll('.viz-carousel').forEach(root => {
  const variants = Array.from(root.children).filter(child => child.hasAttribute('data-variant'));
  if (variants.length < 2 || root.querySelector('[data-ri-variants]')) return;
  let index = Math.max(0, variants.findIndex(variant => !variant.hidden));
  const nav = document.createElement('nav');
  nav.setAttribute('data-ri-variants', '');
  nav.setAttribute('aria-label', 'Preview variants');
  const previous = document.createElement('button');
  previous.type = 'button'; previous.textContent = 'Previous';
  const picker = document.createElement('select'); picker.setAttribute('aria-label', 'Choose preview variant');
  variants.forEach((variant, i) => {
    const option = document.createElement('option'); option.value = String(i); option.textContent = variant.dataset.variant;
    picker.append(option);
  });
  const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Next';
  const show = i => {
    index = (i + variants.length) % variants.length;
    variants.forEach((variant, at) => { variant.hidden = at !== index; });
    picker.value = String(index);
    window.dispatchEvent(new Event('resize'));
  };
  previous.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  picker.addEventListener('change', () => show(Number(picker.value)));
  nav.append(previous, picker, next); root.append(nav); show(index);
});`;

/** Called only in the browser. DOMParser is inert: source scripts execute
 * only after the serialized document enters the sandboxed iframe. */
export function htmlPreviewDocument(html: string, theme: 'light' | 'dark', interactive = true): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = interactive ? HTML_PREVIEW_CSP : HTML_PREVIEW_CSP.replace("script-src 'unsafe-inline' https:", "script-src 'none'");
  // A thumbnail is markup and styles only. It never runs background app
  // logic, refreshes itself or lets a hidden frame capture keyboard input.
  if (!interactive) {
    doc.querySelectorAll('script, meta[http-equiv="refresh" i]').forEach(node => node.remove());
    doc.documentElement.style.overflow = 'hidden';
  }
  const viewport = doc.createElement('meta');
  viewport.name = 'viewport';
  viewport.content = 'width=device-width, initial-scale=1';
  const style = doc.createElement('style');
  style.textContent = `:root{color-scheme:${theme}}body{margin:0}[data-ri-variants]{position:sticky;bottom:12px;z-index:1000;display:flex;justify-content:center;gap:8px;width:max-content;max-width:calc(100% - 24px);margin:12px auto;padding:8px;border:1px solid light-dark(#ddd,#444);border-radius:12px;background:light-dark(#fff,#202020);color:light-dark(#222,#eee);font:13px system-ui}[data-ri-variants] button,[data-ri-variants] select{font:inherit;padding:6px 8px;background:transparent;color:inherit;border:1px solid light-dark(#ddd,#555);border-radius:6px;cursor:pointer}[data-ri-variants] select{min-width:0}`;
  if (!interactive) style.textContent += '*{animation-duration:0s!important;animation-iteration-count:1!important;animation-fill-mode:both!important;transition:none!important}';
  doc.head.prepend(policy, viewport, style);
  if (interactive) {
    const navigation = doc.createElement('script');
    navigation.textContent = VARIANT_NAVIGATION;
    doc.body.append(navigation);
  }
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
