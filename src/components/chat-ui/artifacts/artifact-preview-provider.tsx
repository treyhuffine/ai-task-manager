'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { readPreviewPlace, usePreviewPlace, writePreviewPlace } from '@/lib/client/preview-place';
import { type ArtifactPreview } from './artifact-previews';
import { ArtifactPreviewStore, type BesideRegion, type CardMode, type OpenPreview } from './artifact-preview-store';
import { PlaceSwitch, PreviewBody, PreviewDownload, PreviewSteps, previewName, previewSource } from './artifact-preview-parts';

export type { ArtifactPreview } from './artifact-previews';
export type { OpenPreview } from './artifact-preview-store';

const ArtifactPreviewContext = createContext<ArtifactPreviewStore | null>(null);

const noDialog = () => null;

/** Keep previews outside responsive transcript subtrees so resizing or
 * remounting a message does not discard the artifact's state. One store for
 * the page holds the large dialog and the file beside each chat surface
 * (`artifact-preview-store.ts`). The dialog renders here. A file beside a
 * chat renders in the surface's own panel (`artifact-beside.tsx`). */
export function ArtifactPreviewProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new ArtifactPreviewStore({ place: readPreviewPlace(), writePlace: writePreviewPlace }));
  // Another tab of Ri moving a file changes where files open here too.
  const [place] = usePreviewPlace();
  useEffect(() => store.syncPlace(place), [store, place]);

  const dialog = useSyncExternalStore(store.subscribe, () => store.getState().dialog, noDialog);
  // Whether the chat it came from has a panel to move it into, and on which side.
  const besideSide = useSyncExternalStore(store.subscribe, () => store.region(store.getState().dialog?.host ?? null)?.side ?? null, noDialog);

  const isOpen = !!dialog;
  useEffect(() => {
    if (!isOpen) return;
    // On the window, so it works wherever focus sits in the dialog, even on a
    // button that just disabled at the end. Keys inside an HTML artifact stay
    // in its frame and never get here.
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const delta = matchesHotkey(event, HOTKEYS.previewNext) ? 1 : matchesHotkey(event, HOTKEYS.previewPrevious) ? -1 : 0;
      if (!delta || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
      event.preventDefault();
      store.step('dialog', delta);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, store]);

  const preview = dialog?.preview;
  const index = dialog?.trigger ? dialog.sequence.indexOf(dialog.trigger) : -1;
  const count = dialog?.sequence.length ?? 0;
  return (
    <ArtifactPreviewContext.Provider value={store}>
      {children}
      <Dialog open={isOpen} onOpenChange={value => { if (!value) store.closeDialog(); }}>
        <DialogContent
          className="flex h-[90dvh] w-[calc(100%-2rem)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[min(90vw,1440px)]"
          onCloseAutoFocus={event => {
            event.preventDefault();
            // The card last shown, after any Previous or Next.
            if (store.dialogReturn?.isConnected) store.dialogReturn.focus();
          }}
        >
          <div className="flex min-w-0 shrink-0 items-center gap-3 border-b border-border px-4 py-3 pr-14">
            <div className="min-w-0 flex-1">
              <DialogTitle className="w-fit max-w-full truncate text-sm">{preview && previewName(preview)}</DialogTitle>
              {/* Every kind shows where the file is, so the header keeps its height from one to the next. */}
              <DialogDescription className="mt-1 truncate font-mono text-[11px] select-text">{preview && previewSource(preview)}</DialogDescription>
            </div>
            {preview && <PreviewDownload preview={preview} />}
            <PreviewSteps index={index} count={count} onStep={delta => store.step('dialog', delta)} />
            {besideSide && <PlaceSwitch place="large" side={besideSide} onMove={() => store.toBeside()} />}
          </div>
          <div className="min-h-0 flex-1">{preview && <PreviewBody preview={preview} />}</div>
        </DialogContent>
      </Dialog>
    </ArtifactPreviewContext.Provider>
  );
}

export function useArtifactPreviewStore(): ArtifactPreviewStore {
  const store = useContext(ArtifactPreviewContext);
  if (!store) throw new Error('useArtifactPreview must be used within ArtifactPreviewProvider');
  return store;
}

/** Open a preview from `trigger`, the card it came from: beside its chat, or large. */
export function useArtifactPreview() {
  return useArtifactPreviewStore().open;
}

/** A card's ref: registers it as a Previous and Next stop while mounted. */
export function useArtifactPreviewCard(preview: ArtifactPreview) {
  const { register } = useArtifactPreviewStore();
  return useCallback((card: HTMLElement | null) => (card ? register(card, preview) : undefined), [register, preview]);
}

const largeMode = (): CardMode => 'large';

/** How the card `card` opens now, and whether its file is the one beside its chat. */
export function useArtifactCardMode(card: HTMLElement | null): CardMode {
  const store = useArtifactPreviewStore();
  return useSyncExternalStore(store.subscribe, () => store.cardMode(card), largeMode);
}

/** The file beside the chat on surface `host`, or null. */
export function useBesidePreview(host: string | null): OpenPreview | null {
  const store = useArtifactPreviewStore();
  return useSyncExternalStore(store.subscribe, () => (host ? store.getState().beside.get(host) ?? null : null), noDialog);
}

/**
 * Make this panel the place `host`'s chat opens files beside it, while
 * `available` (on screen, with room). `show` brings the file's tab forward
 * each time one opens there, and `showing` says it is in front and on
 * screen. Several copies of a surface (the dashboard's hidden layouts) may
 * register: the one available shows it.
 */
export function useBesideRegion(host: string | null, { available, side, showing, show }: BesideRegion) {
  const store = useArtifactPreviewStore();
  const [key] = useState(() => Symbol('beside-region'));
  const showRef = useRef(show);
  useEffect(() => { showRef.current = show; });
  useEffect(() => {
    if (!host) return;
    store.setRegion(host, key, { available, side, showing, show: () => showRef.current() });
    return () => store.setRegion(host, key, null);
  }, [store, host, key, available, side, showing]);
}
