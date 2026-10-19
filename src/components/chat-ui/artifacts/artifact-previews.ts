/** What the artifact dialog shows (`artifact-preview-provider.tsx`). */
export type ArtifactPreview =
  | { kind: 'html'; sessionId: string; path: string }
  | { kind: 'image'; src: string; name: string; alt: string }
  /** `src` serves the PDF (`reply-pdf.ts`). `source` is where it is: the path
   * the agent wrote, or the uploaded file's name. */
  | { kind: 'pdf'; src: string; name: string; source: string };

/** The cards Previous and Next move between: the ones in the same chat
 * transcript (the `role="log"` around a conversation), or in the same dialog
 * or slideout. Cards in neither share the page. */
const GROUP = '[role="log"], [role="dialog"]';

/** Marks an artifact card's button (`artifact-card.tsx`). */
const CARD = '[data-artifact-card]';

export function artifactGroup(card: Element): Element | null {
  return card.closest(GROUP);
}

/** Shown on screen. The dashboard keeps a hidden copy of its layout for
 * each screen size, and a hidden copy's cards are not stops. */
export function cardShown(card: Element): boolean {
  return card.getClientRects().length > 0;
}

/** The trigger's group of cards, in transcript order (a query's document
 * order). `registered` says which cards can open. The trigger always counts
 * while it is on the page, so the dialog knows its place. */
export function artifactSequence(trigger: Element, registered: (card: Element) => boolean, shown: (card: Element) => boolean = cardShown): Element[] {
  const group = artifactGroup(trigger);
  return [...(group ?? trigger.ownerDocument).querySelectorAll(CARD)]
    .filter(card => card === trigger || (registered(card) && artifactGroup(card) === group && shown(card)));
}

/** Whether two cards open the same thing, to find the open preview's card
 * again after the transcript remounts under the dialog. */
export function sameArtifact(a: ArtifactPreview, b: ArtifactPreview): boolean {
  if (a.kind === 'html') return b.kind === 'html' && a.sessionId === b.sessionId && a.path === b.path;
  return b.kind !== 'html' && b.kind === a.kind && a.src === b.src;
}
