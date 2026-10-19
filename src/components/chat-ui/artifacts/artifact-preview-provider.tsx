'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tip } from '@/components/ui/tip';
import { HtmlView } from '@/components/chat-ui/artifacts/html-view';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { sessionFolder } from '@/lib/folders/source';
import { artifactImageSource } from '@/lib/sessions/artifact-image';
import { artifactSequence, cardShown, sameArtifact, type ArtifactPreview } from './artifact-previews';
import { PreviewImage } from './preview-image';

export type { ArtifactPreview } from './artifact-previews';

type ArtifactPreviews = {
  open: (preview: ArtifactPreview, trigger: HTMLElement) => void;
  /** Make a card a stop for the dialog's Previous and Next. Returns its release. */
  register: (card: HTMLElement, preview: ArtifactPreview) => () => void;
};

/** The open preview, the card it came from, and that card's group in order. */
type View = { preview: ArtifactPreview; trigger: HTMLElement; sequence: HTMLElement[] };

const ArtifactPreviewContext = createContext<ArtifactPreviews | null>(null);

/** Keep the preview outside responsive transcript subtrees so resizing or
 * remounting its original message does not discard the artifact's state. */
export function ArtifactPreviewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View | null>(null);
  // Mirrors `view` for handlers and card registration, which run outside render.
  const viewRef = useRef<View | null>(null);
  // The card focus returns to on close: the last one shown, after any Previous or Next.
  const triggerRef = useRef<HTMLElement | null>(null);
  const cards = useRef(new Map<HTMLElement, ArtifactPreview>());

  const show = useCallback((next: View | null) => {
    viewRef.current = next;
    if (next) triggerRef.current = next.trigger;
    setView(next);
  }, []);

  /** Place `preview` among the cards as they are now. A transcript that
   * remounted under the dialog has new cards, so find the same artifact again. */
  const place = useCallback((preview: ArtifactPreview, trigger: HTMLElement): View => {
    let card = trigger;
    if (!card.isConnected) {
      for (const [candidate, candidatePreview] of cards.current) {
        if (candidate.isConnected && sameArtifact(candidatePreview, preview) && cardShown(candidate)) { card = candidate; break; }
      }
    }
    return { preview, trigger: card, sequence: artifactSequence(card, candidate => cards.current.has(candidate as HTMLElement)) as HTMLElement[] };
  }, []);

  const open = useCallback((preview: ArtifactPreview, trigger: HTMLElement) => show(place(preview, trigger)), [place, show]);

  const register = useCallback((card: HTMLElement, preview: ArtifactPreview) => {
    cards.current.set(card, preview);
    // A reply still streaming can add a card while the dialog is open.
    const replace = () => { const current = viewRef.current; if (current) show(place(current.preview, current.trigger)); };
    replace();
    return () => {
      if (cards.current.get(card) === preview) cards.current.delete(card);
      replace();
    };
  }, [place, show]);

  const step = useCallback((delta: 1 | -1) => {
    const current = viewRef.current;
    if (!current) return;
    const placed = place(current.preview, current.trigger);
    const index = placed.sequence.indexOf(placed.trigger);
    // A preview opened from something other than a card has no place to move from.
    const next = index < 0 ? undefined : placed.sequence[index + delta];
    const preview = next && cards.current.get(next);
    show(next && preview ? place(preview, next) : placed);
  }, [place, show]);

  const isOpen = !!view;
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
      step(delta);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, step]);

  const value = useMemo(() => ({ open, register }), [open, register]);
  const preview = view?.preview;
  const index = view ? view.sequence.indexOf(view.trigger) : -1;
  const count = view?.sequence.length ?? 0;
  return (
    <ArtifactPreviewContext.Provider value={value}>
      {children}
      <Dialog open={isOpen} onOpenChange={value => { if (!value) show(null); }}>
        <DialogContent
          className="flex h-[90dvh] w-[calc(100%-2rem)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[min(90vw,1440px)]"
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (triggerRef.current?.isConnected) triggerRef.current.focus();
          }}
        >
          <div className="flex min-w-0 shrink-0 items-center gap-3 border-b border-border px-4 py-3 pr-14">
            <div className="min-w-0 flex-1">
              <DialogTitle className="w-fit max-w-full truncate text-sm">{preview?.kind === 'html' ? preview.path.split('/').at(-1) : preview?.name}</DialogTitle>
              {/* Both kinds show where the file is, so the header keeps its height from one to the next. */}
              <DialogDescription className="mt-1 truncate font-mono text-[11px] select-text">{preview?.kind === 'image' ? artifactImageSource(preview.src) : preview?.path}</DialogDescription>
            </div>
            {count > 1 && index >= 0 && (
              <div className="flex shrink-0 items-center gap-1">
                <Tip label="Previous" shortcut={HOTKEYS.previewPrevious.label}>
                  <Button variant="ghost" size="icon-sm" aria-label="Previous preview" disabled={index === 0} onClick={() => step(-1)}><ChevronLeft /></Button>
                </Tip>
                <span className="min-w-12 text-center text-[11px] text-muted-foreground tabular-nums">{index + 1} of {count}</span>
                <Tip label="Next" shortcut={HOTKEYS.previewNext.label}>
                  <Button variant="ghost" size="icon-sm" aria-label="Next preview" disabled={index === count - 1} onClick={() => step(1)}><ChevronRight /></Button>
                </Tip>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {preview?.kind === 'html' && <HtmlView key={`${preview.sessionId}:${preview.path}`} source={sessionFolder(preview.sessionId)} path={preview.path} />}
            {preview?.kind === 'image' && <PreviewImage key={preview.src} src={preview.src} alt={preview.alt || preview.name} className="h-full w-full object-contain p-3" />}
          </div>
        </DialogContent>
      </Dialog>
    </ArtifactPreviewContext.Provider>
  );
}

function useArtifactPreviews(): ArtifactPreviews {
  const previews = useContext(ArtifactPreviewContext);
  if (!previews) throw new Error('useArtifactPreview must be used within ArtifactPreviewProvider');
  return previews;
}

/** Open a preview from `trigger`, the element focus returns to on close. */
export function useArtifactPreview() {
  return useArtifactPreviews().open;
}

/** A card's ref: registers it as a Previous and Next stop while mounted. */
export function useArtifactPreviewCard(preview: ArtifactPreview) {
  const { register } = useArtifactPreviews();
  return useCallback((card: HTMLElement | null) => (card ? register(card, preview) : undefined), [register, preview]);
}
