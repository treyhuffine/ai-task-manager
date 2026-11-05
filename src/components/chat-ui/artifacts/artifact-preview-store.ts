import type { PreviewPlace } from '@/lib/client/preview-place';
import { composerTarget, composerWithin } from '@/components/chat/editor/composer-focus';
import { artifactSequence, cardShown, sameArtifact, type ArtifactPreview } from './artifact-previews';

/** An open preview: what it shows, the card it came from, and that card's
 * group in order (Previous and Next). `trigger` is null once its card left
 * the page and no copy of it came back, so a file left open beside a chat
 * holds no transcript that is gone. */
export type OpenPreview = { preview: ArtifactPreview; trigger: HTMLElement | null; sequence: HTMLElement[] };

/** The large dialog's preview, and the chat it came from, so it can move beside that chat. */
export type DialogPreview = OpenPreview & { host: string | null };

/** A panel beside a chat that can hold a file as one of its tabs. */
export type BesideRegion = {
  /** On screen, with room to show a file now. */
  available: boolean;
  /** Which side of the chat it is on. */
  side: 'left' | 'right';
  /** The file's tab is in front and on screen, so its card is marked. */
  showing: boolean;
  /** Bring the file's tab to the front. Called each time a file opens beside the chat. */
  show: () => void;
};

export type PreviewState = {
  dialog: DialogPreview | null;
  /** The file beside each chat surface, by host. */
  beside: ReadonlyMap<string, OpenPreview>;
};

/** How a card opens when clicked: its file is on screen beside its chat
 * (`shown`), beside the chat on that side, or the large dialog. */
export type CardMode = 'shown' | 'left' | 'right' | 'large';

/** Marks the part of a surface whose cards can open beside it. Its value
 * names the surface (`home:a`, `execution:<id>`, `agent:<id>`), and the
 * panel that shows those files registers as its region. */
export const PREVIEW_HOST_ATTRIBUTE = 'data-preview-host';

export function previewHost(element: Element): string | null {
  return element.closest(`[${PREVIEW_HOST_ATTRIBUTE}]`)?.getAttribute(PREVIEW_HOST_ATTRIBUTE) ?? null;
}

/** A field being typed in. A file opening never takes focus from one. */
const TEXT_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** The composer of the chat on surface `host`: the copy on screen, where a
 * surface has hidden ones. With no surface, the composer ⌘I goes to. */
function chatComposer(host: string | null) {
  if (host === null) return composerTarget();
  for (const surface of document.querySelectorAll(`[${PREVIEW_HOST_ATTRIBUTE}]`)) {
    const composer = surface.getAttribute(PREVIEW_HOST_ATTRIBUTE) === host ? composerWithin(surface) : null;
    if (composer) return composer;
  }
  return null;
}

function samePlacement(a: OpenPreview, b: OpenPreview): boolean {
  return a.preview === b.preview && a.trigger === b.trigger && a.sequence.length === b.sequence.length && a.sequence.every((card, index) => card === b.sequence[index]);
}

type Options = {
  place: PreviewPlace;
  /** Saves the place the next file opens in, when the person moves one. */
  writePlace: (place: PreviewPlace) => void;
  /** Whether a card is on screen (a hidden copy of the layout is not). */
  shown?: (card: Element) => boolean;
  /** Runs the re-placement after cards come and go, once per batch. */
  schedule?: (run: () => void) => void;
};

/**
 * Every open artifact preview: the large dialog, and the file beside each
 * chat surface. One store for the whole page (`ArtifactPreviewProvider`), so
 * a transcript that remounts, or a surface left and come back to, finds its
 * file where it was. Cards register while mounted, which is what Previous and
 * Next move between and how a preview finds its card again after a remount.
 */
export class ArtifactPreviewStore {
  private readonly cards = new Map<HTMLElement, ArtifactPreview>();
  private readonly regions = new Map<string, Map<symbol, BesideRegion>>();
  /** The file views beside each chat, by host: more than one where a surface has copies (the dashboard's hidden layouts). */
  private readonly views = new Map<string, Set<HTMLElement>>();
  private readonly listeners = new Set<() => void>();
  private state: PreviewState = { dialog: null, beside: new Map() };
  private place: PreviewPlace;
  private replaceQueued = false;
  private readonly shown: (card: Element) => boolean;
  private readonly schedule: (run: () => void) => void;
  /** The card focus returns to when the dialog closes: the last one it showed. */
  dialogReturn: HTMLElement | null = null;
  /** The chat the dialog's file came from, and whether the file moved beside it, which focus follows. */
  private dialogFrom: { host: string | null; movedBeside: boolean } = { host: null, movedBeside: false };

  constructor(private readonly options: Options) {
    this.place = options.place;
    this.shown = options.shown ?? cardShown;
    // Called bare, queueMicrotask would lose its window ("Illegal invocation").
    this.schedule = options.schedule ?? (run => queueMicrotask(run));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getState = () => this.state;

  private set(next: Partial<PreviewState>) {
    // A dialog that opens starts from its own card, or none. Previous and
    // Next, or a remount finding the card again, move it along.
    if (next.dialog && (!this.state.dialog || next.dialog.trigger)) this.dialogReturn = next.dialog.trigger;
    if (next.dialog && !this.state.dialog) this.dialogFrom = { host: next.dialog.host, movedBeside: false };
    this.state = { ...this.state, ...next };
    this.emit();
  }

  private emit() {
    for (const listener of [...this.listeners]) listener();
  }

  /** The place files open in. Another tab of Ri changing it reaches here too. */
  syncPlace(place: PreviewPlace) {
    if (place === this.place) return;
    this.place = place;
    this.emit();
  }

  /** The panel showing `host`'s files now, or null when none is on screen. */
  region(host: string | null): BesideRegion | null {
    if (!host) return null;
    for (const region of this.regions.get(host)?.values() ?? []) if (region.available) return region;
    return null;
  }

  /** Register (or update, under the same key) a panel that shows `host`'s files. `null` releases it. */
  setRegion(host: string, key: symbol, region: BesideRegion | null) {
    let byKey = this.regions.get(host);
    const before = byKey?.get(key);
    if (region) {
      if (!byKey) this.regions.set(host, byKey = new Map());
      byKey.set(key, region);
    } else {
      byKey?.delete(key);
      if (byKey?.size === 0) this.regions.delete(host);
    }
    // Cards and the dialog say where a file goes and whether it shows, so they follow these.
    if (before?.available !== region?.available || before?.side !== region?.side || before?.showing !== region?.showing) this.emit();
  }

  /** How `card` opens now. A primitive, so cards re-render only when theirs changes. */
  cardMode(card: HTMLElement | null): CardMode {
    if (!card) return 'large';
    const host = previewHost(card);
    // Marked only while its file is in sight: not behind another tab or a closed panel.
    if (host && this.state.beside.get(host)?.trigger === card && [...this.regions.get(host)?.values() ?? []].some(region => region.showing)) return 'shown';
    const region = this.place === 'beside' ? this.region(host) : null;
    return region ? region.side : 'large';
  }

  /** Open `preview` from `trigger`: beside its chat when files open there and
   * the chat has a panel on screen, else in the dialog. Returns the chat's
   * host when it opened beside it. */
  open = (preview: ArtifactPreview, trigger: HTMLElement): string | null => {
    const host = previewHost(trigger);
    if (host && this.place === 'beside' && this.region(host)) {
      this.showBeside(host, this.locate(preview, trigger, host));
      return host;
    }
    this.set({ dialog: { ...this.locate(preview, trigger), host } });
    return null;
  };

  /** Make a card a stop for Previous and Next while mounted. Returns its release. */
  register = (card: HTMLElement, preview: ArtifactPreview) => {
    this.cards.set(card, preview);
    this.queueReplace();
    return () => {
      if (this.cards.get(card) === preview) this.cards.delete(card);
      this.queueReplace();
    };
  };

  /** Make `view` a file view beside `host`'s chat while mounted, one focus can go to. Returns its release. */
  registerView = (host: string, view: HTMLElement) => {
    let views = this.views.get(host);
    if (!views) this.views.set(host, views = new Set());
    views.add(view);
    return () => {
      views.delete(view);
      if (views.size === 0 && this.views.get(host) === views) this.views.delete(host);
    };
  };

  /** Put focus in the file beside `host`'s chat, so its keys work straight
   * away, as a dialog's do: in the copy of its view that can take it (in
   * front, on screen), never from a field being typed in. Called once its
   * panel has drawn it in front. Whether focus is in the view now. */
  focusBeside(host: string): boolean {
    for (const view of this.views.get(host) ?? []) {
      const active = view.ownerDocument.activeElement;
      if (active && view.contains(active)) return true;
      if (active?.closest(TEXT_FIELD)) return false;
      view.focus({ preventScroll: true });
      if (view.ownerDocument.activeElement === view) return true;
    }
    return false;
  }

  /** Put focus back after a file closes: on `card`, the one it last showed,
   * else on the composer of the chat on `host` (the card's transcript has
   * gone), rather than the page. */
  returnFocus(card: HTMLElement | null, host: string | null, options?: FocusOptions) {
    if (card?.isConnected) card.focus(options);
    else chatComposer(host)?.focus();
  }

  /** Once the dialog has closed: focus follows its file beside the chat when
   * it moved there, else goes back to the card it last showed. */
  focusAfterDialog() {
    const { host, movedBeside } = this.dialogFrom;
    if (host && movedBeside && this.focusBeside(host)) return;
    this.returnFocus(this.dialogReturn, host);
  }

  /** Move an open preview to the previous or next card in its group. `target` is `dialog` or a host. */
  step(target: 'dialog' | { host: string }, delta: 1 | -1) {
    const host = target === 'dialog' ? undefined : target.host;
    const current = host === undefined ? this.state.dialog : this.state.beside.get(host);
    if (!current) return;
    const placed = this.locate(current.preview, current.trigger, host);
    const index = placed.trigger ? placed.sequence.indexOf(placed.trigger) : -1;
    // A preview opened from something other than a card has no place to move from.
    const next = index < 0 ? undefined : placed.sequence[index + delta];
    const preview = next && this.cards.get(next);
    const result = next && preview ? this.locate(preview, next, host) : placed;
    if (host === undefined) this.set({ dialog: { ...result, host: this.state.dialog!.host } });
    else this.setBeside(host, result);
  }

  closeDialog() {
    if (this.state.dialog) this.set({ dialog: null });
  }

  /** Close the file beside `host`'s chat. Returns its card, for focus to go back to. */
  closeBeside(host: string): HTMLElement | null {
    const current = this.state.beside.get(host);
    this.setBeside(host, null);
    if (!current) return null;
    return current.trigger?.isConnected ? current.trigger : null;
  }

  /** Move the file beside `host`'s chat into the dialog, and open files there from now on. */
  toLarge(host: string) {
    const current = this.state.beside.get(host);
    if (!current) return;
    this.choose('large');
    const beside = new Map(this.state.beside);
    beside.delete(host);
    this.set({ beside, dialog: { ...current, host } });
  }

  /** Move the dialog's preview beside the chat it came from, and open files there from now on. */
  toBeside() {
    const dialog = this.state.dialog;
    if (!dialog?.host || !this.region(dialog.host)) return;
    this.choose('beside');
    this.dialogFrom = { host: dialog.host, movedBeside: true };
    const { host, ...open } = dialog;
    const beside = new Map(this.state.beside);
    beside.set(host!, open);
    this.set({ dialog: null, beside });
    this.showRegions(host!);
  }

  private choose(place: PreviewPlace) {
    this.place = place;
    this.options.writePlace(place);
  }

  /** Show `open` beside `host`'s chat. Opening the file already there still brings its tab forward. */
  private showBeside(host: string, open: OpenPreview) {
    this.setBeside(host, open);
    this.showRegions(host);
  }

  private showRegions(host: string) {
    for (const region of this.regions.get(host)?.values() ?? []) if (region.available) region.show();
  }

  private setBeside(host: string, open: OpenPreview | null) {
    const current = this.state.beside.get(host);
    if (open ? current && samePlacement(open, current) : !current) return;
    const beside = new Map(this.state.beside);
    if (open) beside.set(host, open);
    else beside.delete(host);
    this.set({ beside });
  }

  /** Place `preview` among the cards as they are now. A transcript that
   * remounted has new cards, so find the same artifact again: anywhere for
   * the dialog, in the same surface for a file beside a chat. */
  private locate(preview: ArtifactPreview, trigger: HTMLElement | null, host?: string): OpenPreview {
    let card = trigger?.isConnected ? trigger : null;
    // A copy on screen first. With the chat folded away (an expanded panel), any in the same surface.
    for (const onScreen of host === undefined ? [true] : [true, false]) {
      if (card) break;
      for (const [candidate, candidatePreview] of this.cards) {
        if (candidate.isConnected && sameArtifact(candidatePreview, preview) && (!onScreen || this.shown(candidate)) && (host === undefined || previewHost(candidate) === host)) { card = candidate; break; }
      }
    }
    if (!card) return { preview, trigger: null, sequence: [] };
    return { preview, trigger: card, sequence: artifactSequence(card, candidate => this.cards.has(candidate as HTMLElement), this.shown) as HTMLElement[] };
  }

  private queueReplace() {
    if (this.replaceQueued) return;
    this.replaceQueued = true;
    this.schedule(() => {
      this.replaceQueued = false;
      this.replaceAll();
    });
  }

  /** Cards came or went (a reply streaming in, a transcript remounting): place every open preview again. */
  private replaceAll() {
    const next: Partial<PreviewState> = {};
    const dialog = this.state.dialog;
    if (dialog) {
      const placed = this.locate(dialog.preview, dialog.trigger);
      if (!samePlacement(placed, dialog)) next.dialog = { ...placed, host: dialog.host };
    }
    let beside: Map<string, OpenPreview> | null = null;
    for (const [host, open] of this.state.beside) {
      const placed = this.locate(open.preview, open.trigger, host);
      if (samePlacement(placed, open)) continue;
      beside ??= new Map(this.state.beside);
      beside.set(host, placed);
    }
    if (beside) next.beside = beside;
    if (next.dialog || next.beside) this.set(next);
  }
}
