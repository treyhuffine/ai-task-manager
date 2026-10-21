import { DOMParser } from 'linkedom';
import { describe, expect, it, vi } from 'vitest';
import type { PreviewPlace } from '@/lib/client/preview-place';
import { ArtifactPreviewStore, previewHost } from './artifact-preview-store';
import type { ArtifactPreview } from './artifact-previews';

// A Home with the chat in panel A, an execution chat, and a slideout with no
// panel beside it. Cards open beside their chat when files open there and
// the chat has a panel on screen, else large.
const page = () => new DOMParser().parseFromString(`<html><body>
  <div data-preview-host="home:a"><section role="log">
    <button data-artifact-card id="a1"></button><button data-artifact-card id="a2"></button><button data-artifact-card id="a3"></button>
  </section></div>
  <div data-preview-host="execution:x"><section role="log"><button data-artifact-card id="x1"></button></section></div>
  <div role="dialog"><button data-artifact-card id="s1"></button></div>
</body></html>`, 'text/html') as unknown as Document;

const pdf = (name: string): ArtifactPreview => ({ kind: 'pdf', src: `/pdf/${name}`, name, source: `/tmp/${name}` });

function setup(place: PreviewPlace = 'beside') {
  const doc = page();
  const written: PreviewPlace[] = [];
  const store = new ArtifactPreviewStore({ place, writePlace: next => written.push(next), shown: () => true, schedule: run => run() });
  const card = (id: string) => doc.getElementById(id) as HTMLElement;
  const previews = new Map<string, ArtifactPreview>();
  const releases = new Map<string, () => void>();
  for (const id of ['a1', 'a2', 'a3', 'x1', 's1']) {
    previews.set(id, pdf(`${id}.pdf`));
    releases.set(id, store.register(card(id), previews.get(id)!));
  }
  const show = vi.fn();
  const key = Symbol('panel b');
  store.setRegion('home:a', key, { available: true, side: 'right', showing: true, show });
  return { doc, store, card, previews, releases, show, key, written };
}

describe('ArtifactPreviewStore', () => {
  it('opens a card beside its chat as a tab, and brings that tab forward', () => {
    const { store, card, previews, show } = setup();
    store.open(previews.get('a2')!, card('a2'));
    const beside = store.getState().beside.get('home:a')!;
    expect(beside.preview).toBe(previews.get('a2'));
    expect(beside.sequence.map(el => el.id)).toEqual(['a1', 'a2', 'a3']);
    expect(store.getState().dialog).toBeNull();
    expect(show).toHaveBeenCalledTimes(1);
    expect(store.cardMode(card('a2'))).toBe('shown');
    expect(store.cardMode(card('a1'))).toBe('right');
    // The same file again: nothing moves, but its tab comes forward.
    const state = store.getState();
    store.open(previews.get('a2')!, card('a2'));
    expect(store.getState()).toBe(state);
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('opens large where there is no panel beside the chat, or while files open large', () => {
    const { store, card, previews, key } = setup();
    store.open(previews.get('s1')!, card('s1'));
    expect(store.getState().dialog).toMatchObject({ preview: previews.get('s1'), host: null });
    store.closeDialog();
    store.open(previews.get('x1')!, card('x1'));
    expect(store.getState().dialog).toMatchObject({ host: 'execution:x' });
    expect(store.cardMode(card('x1'))).toBe('large');
    store.closeDialog();
    // Panel B off screen (a hidden copy of the layout): large.
    store.setRegion('home:a', key, { available: false, side: 'right', showing: false, show: () => {} });
    expect(store.cardMode(card('a1'))).toBe('large');
    store.open(previews.get('a1')!, card('a1'));
    expect(store.getState().dialog).toMatchObject({ host: 'home:a' });
    expect(store.getState().beside.size).toBe(0);

    const large = setup('large');
    large.store.open(large.previews.get('a1')!, large.card('a1'));
    expect(large.store.getState().dialog).toMatchObject({ host: 'home:a' });
    expect(large.store.cardMode(large.card('a1'))).toBe('large');
  });

  it('moves a file between large and beside, and opens the next one wherever it went', () => {
    const { store, card, previews, show, written } = setup();
    store.open(previews.get('a1')!, card('a1'));
    store.toLarge('home:a');
    expect(store.getState().beside.size).toBe(0);
    expect(store.getState().dialog).toMatchObject({ preview: previews.get('a1'), trigger: card('a1'), host: 'home:a' });
    expect(store.dialogReturn).toBe(card('a1'));
    expect(written).toEqual(['large']);
    store.closeDialog();
    store.open(previews.get('a3')!, card('a3'));
    expect(store.getState().dialog).toMatchObject({ preview: previews.get('a3') });

    store.toBeside();
    expect(store.getState().dialog).toBeNull();
    expect(store.getState().beside.get('home:a')).toMatchObject({ preview: previews.get('a3'), trigger: card('a3') });
    expect(written).toEqual(['large', 'beside']);
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('only moves a dialog beside a chat that has a panel on screen', () => {
    const { store, card, previews, written } = setup();
    store.open(previews.get('s1')!, card('s1'));
    store.toBeside();
    expect(store.getState().dialog).toMatchObject({ preview: previews.get('s1') });
    expect(written).toEqual([]);
  });

  it('steps through the chat\'s files beside it, stopping at the ends', () => {
    const { store, card, previews } = setup();
    store.open(previews.get('a2')!, card('a2'));
    store.step({ host: 'home:a' }, 1);
    expect(store.getState().beside.get('home:a')).toMatchObject({ preview: previews.get('a3'), trigger: card('a3') });
    expect(store.cardMode(card('a3'))).toBe('shown');
    expect(store.cardMode(card('a2'))).toBe('right');
    store.step({ host: 'home:a' }, 1);
    expect(store.getState().beside.get('home:a')!.trigger).toBe(card('a3'));
    store.step({ host: 'home:a' }, -1);
    store.step({ host: 'home:a' }, -1);
    expect(store.getState().beside.get('home:a')!.trigger).toBe(card('a1'));
  });

  it('marks the card only while its file is in front and on screen', () => {
    const { store, card, previews, key } = setup();
    const listener = vi.fn();
    store.open(previews.get('a1')!, card('a1'));
    store.subscribe(listener);
    // Another tab in front of the file, or the panel closed over it.
    store.setRegion('home:a', key, { available: true, side: 'right', showing: false, show: () => {} });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.cardMode(card('a1'))).toBe('right');
    expect(store.getState().beside.get('home:a')!.trigger).toBe(card('a1'));
  });

  it('closes the file beside a chat and hands back its card', () => {
    const { store, card, previews } = setup();
    store.open(previews.get('a1')!, card('a1'));
    expect(store.closeBeside('home:a')).toBe(card('a1'));
    expect(store.getState().beside.size).toBe(0);
    expect(store.cardMode(card('a1'))).toBe('right');
    expect(store.closeBeside('home:a')).toBeNull();
  });

  it('finds its card again after the transcript remounts, only in the same surface', () => {
    const { doc, store, card, previews, releases } = setup();
    store.open(previews.get('a2')!, card('a2'));
    // The transcript goes away (another view opened): the file stays open, holding no card.
    const log = card('a1').parentElement!;
    log.remove();
    for (const id of ['a1', 'a2', 'a3']) releases.get(id)!();
    expect(store.getState().beside.get('home:a')).toMatchObject({ preview: previews.get('a2'), trigger: null, sequence: [] });
    // The same artifact in another surface is not its card.
    const elsewhere = doc.createElement('button');
    elsewhere.setAttribute('data-artifact-card', '');
    doc.querySelector('[data-preview-host="execution:x"] section')!.append(elsewhere);
    store.register(elsewhere as HTMLElement, pdf('a2.pdf'));
    expect(store.getState().beside.get('home:a')!.trigger).toBeNull();
    // Back on the Home: a new card for the same file, and it's marked again.
    const host = doc.querySelector('[data-preview-host="home:a"]')!;
    host.innerHTML = '<section role="log"><button data-artifact-card id="b1"></button><button data-artifact-card id="b2"></button></section>';
    const b1 = doc.getElementById('b1') as HTMLElement;
    const b2 = doc.getElementById('b2') as HTMLElement;
    store.register(b1, pdf('a1.pdf'));
    store.register(b2, pdf('a2.pdf'));
    expect(store.getState().beside.get('home:a')).toMatchObject({ trigger: b2, sequence: [b1, b2] });
    expect(previewHost(b2)).toBe('home:a');
    expect(store.cardMode(b2)).toBe('shown');
  });

  it('notifies on changes that move a file or change where cards open, and not otherwise', () => {
    const { store, card, previews, key } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setRegion('home:a', key, { available: true, side: 'right', showing: true, show: () => {} });
    expect(listener).not.toHaveBeenCalled();
    store.setRegion('home:a', key, { available: true, side: 'left', showing: true, show: () => {} });
    expect(listener).toHaveBeenCalledTimes(1);
    store.open(previews.get('a1')!, card('a1'));
    expect(listener).toHaveBeenCalledTimes(2);
    store.syncPlace('beside');
    expect(listener).toHaveBeenCalledTimes(2);
    store.syncPlace('large');
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.cardMode(card('a2'))).toBe('large');
    // The file already beside the chat stays marked on its card.
    expect(store.cardMode(card('a1'))).toBe('shown');
  });
});
