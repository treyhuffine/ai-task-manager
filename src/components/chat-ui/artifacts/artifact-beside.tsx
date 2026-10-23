'use client';

import { useCallback, useRef, useSyncExternalStore, type ComponentProps } from 'react';
import { X } from 'lucide-react';
import { Tip } from '@/components/ui/tip';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { cn } from '@/lib/utils';
import { useArtifactPreviewStore, useBesidePreview } from './artifact-preview-provider';
import { PlaceSwitch, PreviewBody, PreviewCopyPath, PreviewDownload, PreviewIcon, PreviewSteps, previewName, previewSource } from './artifact-preview-parts';

/**
 * A file beside a chat (docs/chat-sessions.md, "Files beside the chat"). The
 * panel next to the chat (the other Home panel, an execution's tools, an
 * agent's tools) shows it as one more tab: `BesideFileTab` in its tab bar
 * and `BesideFileView` as that tab's body. The chat and the file are both on
 * screen, the tab's × puts it away, and clicking its card in the chat brings
 * it back.
 */

/** Marks the tab and the view, so closing either can tell focus was on something going away. */
const BESIDE_FILE = 'data-beside-file';

/** Close the file beside `host`'s chat. Focus that was on the tab or the
 * view goes back to the file's card, as the dialog's does. */
export function useCloseBesideFile(host: string) {
  const store = useArtifactPreviewStore();
  return useCallback(() => {
    const active = document.activeElement;
    const losingFocus = !active || active === document.body || !!active.closest(`[${BESIDE_FILE}]`);
    const card = store.closeBeside(host);
    if (losingFocus) card?.focus({ preventScroll: true });
  }, [store, host]);
}

/**
 * The file's tab: its name, which brings it forward, and × to close it.
 * Each panel styles it like its own tabs through `className` (the wrapper)
 * and passes its tab semantics in `selectProps`. A `role="tablist"` may only
 * hold tabs, so a panel with one renders `BesideFileClose` after the list
 * and passes `withClose={false}`.
 */
export function BesideFileTab({ host, active, onSelect, className, selectProps, withClose = true }: {
  host: string;
  active: boolean;
  onSelect: () => void;
  className?: string;
  selectProps?: ComponentProps<'button'>;
  withClose?: boolean;
}) {
  const open = useBesidePreview(host);
  if (!open) return null;
  const name = previewName(open.preview);
  return (
    <div {...{ [BESIDE_FILE]: '' }} data-active={active || undefined} className={cn('flex min-w-0 shrink items-center', className)}>
      <Tip label={name} onlyWhenTextHidden>
        <button type="button" aria-pressed={selectProps?.role ? undefined : active} {...selectProps} onClick={onSelect} className="flex min-w-0 items-center gap-1.5 self-stretch outline-none focus-visible:underline">
          <PreviewIcon preview={open.preview} size={12} className="shrink-0" />
          <span className="max-w-40 truncate">{name}</span>
        </button>
      </Tip>
      {withClose && <BesideFileClose host={host} className="ml-1" />}
    </div>
  );
}

/** × for the file beside the chat. */
export function BesideFileClose({ host, className }: { host: string; className?: string }) {
  const open = useBesidePreview(host);
  const close = useCloseBesideFile(host);
  if (!open) return null;
  return (
    <Tip label="Close">
      <button
        type="button"
        {...{ [BESIDE_FILE]: '' }}
        aria-label={`Close ${previewName(open.preview)}`}
        onClick={close}
        className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground', className)}
      >
        <X size={11} />
      </button>
    </Tip>
  );
}

/**
 * The file's tab body: where the file is, Download for a PDF, Previous and
 * Next through the chat's other files, the Large or Beside switch, then the
 * file. Escape inside it closes it. The arrow keys move through the chat's
 * files while focus is in it (not in the chat, where they belong to text).
 */
export function BesideFileView({ host }: { host: string }) {
  const store = useArtifactPreviewStore();
  const open = useBesidePreview(host);
  const close = useCloseBesideFile(host);
  const side = useSyncExternalStore(store.subscribe, () => store.region(host)?.side ?? 'right', () => 'right' as const);
  const sectionRef = useRef<HTMLElement>(null);
  if (!open) return null;
  const { preview, trigger, sequence } = open;
  const index = trigger ? sequence.indexOf(trigger) : -1;
  const step = (delta: 1 | -1) => {
    const section = sectionRef.current;
    const inside = !!section?.contains(document.activeElement);
    store.step({ host }, delta);
    // Next disabling at the last file, or the next file replacing the one
    // focus was in, drops focus to the page. Keep it here so the arrows go on.
    if (inside) requestAnimationFrame(() => {
      if (section?.isConnected && !section.contains(document.activeElement)) section.focus({ preventScroll: true });
    });
  };
  return (
    <section
      ref={sectionRef}
      {...{ [BESIDE_FILE]: '' }}
      aria-label={`${previewName(preview)}, beside the chat`}
      // Focusable, so a click on the image or the header lands here and the arrow keys reach it.
      tabIndex={-1}
      onKeyDown={event => {
        const key = event.nativeEvent;
        if (event.defaultPrevented || key.isComposing) return;
        if (matchesHotkey(key, HOTKEYS.previewClose)) {
          event.preventDefault();
          close();
          return;
        }
        const delta = matchesHotkey(key, HOTKEYS.previewNext) ? 1 : matchesHotkey(key, HOTKEYS.previewPrevious) ? -1 : 0;
        if (!delta || (event.target instanceof Element && event.target.closest('input, textarea, select, audio, video, pre, [contenteditable]:not([contenteditable="false"])'))) return;
        event.preventDefault();
        step(delta);
      }}
      className="flex h-full min-h-0 min-w-0 flex-col bg-background outline-none"
    >
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border py-1 pl-3 pr-2">
        <p className="min-w-0 basis-full truncate font-mono text-[11px] text-muted-foreground select-text">{previewSource(preview)}</p>
        <PreviewCopyPath preview={preview} compact />
        <PreviewDownload preview={preview} compact />
        <PreviewSteps index={index} count={sequence.length} onStep={step} />
        <PlaceSwitch place="beside" side={side} onMove={() => store.toLarge(host)} />
      </div>
      <div className="min-h-0 flex-1"><PreviewBody preview={preview} /></div>
    </section>
  );
}
