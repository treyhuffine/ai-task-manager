/** Refresh browser-completed sign-in when the desktop app regains focus. */
export function watchOAuthReturn(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  refresh: () => Promise<boolean>,
  onComplete: () => void,
  onError: (error: unknown) => void,
): () => void {
  let disposed = false;
  let refreshing = false;
  const stop = () => {
    disposed = true;
    target.removeEventListener('focus', onFocus);
  };
  const onFocus = async () => {
    if (disposed || refreshing) return;
    refreshing = true;
    try {
      if (await refresh() && !disposed) {
        stop();
        onComplete();
      }
    } catch (error) {
      if (!disposed) onError(error);
    } finally { refreshing = false; }
  };
  target.addEventListener('focus', onFocus);
  return stop;
}
