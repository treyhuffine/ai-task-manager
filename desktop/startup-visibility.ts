interface ViewerWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
}
interface LocalSurface {
  reveal(): boolean;
  hide(): boolean;
  close(): void;
  isPresented(): boolean;
}

/** Keep one foreground surface while setup, service readiness and the
 * renderer's voice/background guard finish independently. Native visibility
 * alone is insufficient while a local page is loading in a hidden window. */
export function createStartupVisibility(options: {
  viewer(): ViewerWindow | undefined;
  local: LocalSurface;
  quitting(): boolean;
  revealViewer(): void;
  prepareViewerForBackground(): Promise<void>;
}) {
  let revision = 0;
  let foregroundIntent = false;
  let pendingLocal = false;
  let preparing: Promise<void> | undefined;

  const viewerVisible = () => {
    const window = options.viewer();
    return !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized();
  };
  const prepare = () => {
    if (!preparing) {
      const pending = Promise.resolve().then(options.prepareViewerForBackground);
      preparing = pending;
      void pending.finally(() => { if (preparing === pending) preparing = undefined; }).catch(() => {});
    }
    return preparing;
  };

  return {
    show() {
      if (options.quitting()) return;
      revision++; pendingLocal = false; foregroundIntent = true;
      if (!options.local.reveal()) options.revealViewer();
    },
    showViewer() {
      if (options.quitting()) return;
      revision++; pendingLocal = false; foregroundIntent = true;
      options.local.close(); options.revealViewer();
    },
    async showLocal(open: () => Promise<void>) {
      if (options.quitting()) return;
      const request = ++revision;
      pendingLocal = true; foregroundIntent = true;
      try {
        if (viewerVisible()) await prepare();
        if (options.quitting() || request !== revision || viewerVisible()) return;
        await open();
      } finally { if (request === revision) pendingLocal = false; }
    },
    async hide() {
      if (options.quitting()) return;
      revision++; pendingLocal = false; foregroundIntent = false;
      if (!options.local.hide()) await prepare();
    },
    connected() {
      if (options.quitting()) return;
      const reveal = foregroundIntent && (pendingLocal || options.local.isPresented() || viewerVisible());
      revision++; pendingLocal = false;
      options.local.close();
      if (reveal) options.revealViewer();
    },
  };
}
