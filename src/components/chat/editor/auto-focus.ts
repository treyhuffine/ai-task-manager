/** Mount autofocus yields to any input or dialog opened while the editor was
 * loading. Check in the frame that actually focuses, not before a library
 * schedules another frame. Explicit user focus commands use their own path. */
export function scheduleEditorAutoFocus(target: HTMLElement, focus: () => void): () => void {
  const document = target.ownerDocument;
  const initialFocus = document.activeElement;
  const frame = requestAnimationFrame(() => {
    if (!target.isConnected || !document.hasFocus() || !target.getClientRects().length) return;
    if (target.closest('[inert], [aria-hidden="true"]') || target.getAttribute('contenteditable') !== 'true') return;

    const active = document.activeElement;
    if (target.contains(active)) return;
    if (active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    // A navigation button can retain focus until the new editor is ready.
    // A different button/control means the user has since chosen elsewhere.
    if (active !== initialFocus && active !== document.body) return;
    for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')) {
      // cmdk's role wrapper has no box while its fixed-position children do.
      const visible = dialog.getClientRects().length > 0
        || [...dialog.querySelectorAll<HTMLElement>('*')].some(child => child.getClientRects().length > 0);
      if (!dialog.contains(target) && visible) return;
    }
    focus();
  });
  return () => cancelAnimationFrame(frame);
}
