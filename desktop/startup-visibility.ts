interface NativeWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
}
interface LocalSurface {
  hasActive(): boolean;
  reveal(): boolean;
  focus(): boolean;
  close(): void;
}

/** One native window, two isolated renderers. Covering the app never hides or
 * resizes its window, navigates its document, or discards its drafts. */
export function createStartupVisibility(options: {
  viewer(): NativeWindow | undefined;
  local: LocalSurface;
  quitting(): boolean;
  revealWindow(): void;
  focusViewer(): void;
  backgroundWindow(): void;
  canCoverViewer(): Promise<boolean>;
}) {
  let revision = 0;
  let visibilityIntent = 0;
  let preparing: Promise<boolean> | undefined;
  const visible = () => {
    const window = options.viewer();
    return !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized();
  };
  const prepare = () => {
    if (!preparing) {
      const pending = Promise.resolve().then(options.canCoverViewer);
      preparing = pending;
      void pending.finally(() => { if (preparing === pending) preparing = undefined; }).catch(() => {});
    }
    return preparing;
  };
  const focus = () => { if (!options.local.focus()) options.focusViewer(); };
  return {
    show() {
      if (options.quitting()) return;
      revision++; visibilityIntent++;
      options.local.reveal(); options.revealWindow(); focus();
    },
    showViewer() {
      if (options.quitting()) return;
      revision++; visibilityIntent++;
      options.local.close(); options.revealWindow(); options.focusViewer();
    },
    async showLocal(open: () => Promise<void>) {
      if (options.quitting()) return;
      const request = ++revision;
      visibilityIntent++;
      const wasVisible = visible();
      if (!options.local.hasActive() && !(await prepare())) return;
      if (options.quitting() || request !== revision || (wasVisible && !visible())) return;
      options.revealWindow();
      await open();
      if (!options.quitting() && request === revision && visible()) focus();
    },
    async hide() {
      if (options.quitting()) return;
      revision++;
      const intent = ++visibilityIntent;
      if (!options.local.hasActive() && !(await prepare())) return;
      // Readiness can replace a renderer while this guard waits. It must not
      // override an explicit hide, but a later user presentation request can.
      if (!options.quitting() && intent === visibilityIntent) options.backgroundWindow();
    },
    connected() {
      if (options.quitting()) return;
      revision++;
      options.local.close();
      // No show()/restore(): quiet login and user-minimized windows stay so.
      if (visible()) options.focusViewer();
    },
  };
}
