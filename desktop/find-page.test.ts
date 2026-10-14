import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';
import { findBarPage } from './find-page';

function renderBar() {
  const { document, Event } = parseHTML(findBarPage('test123', { theme: 'light', platform: 'darwin' }));
  let open!: (query: string) => void;
  let result!: (label: string) => void;
  const find = {
    query: vi.fn(), next: vi.fn(), previous: vi.fn(), close: vi.fn(),
    onOpen: (callback: typeof open) => { open = callback; }, onResult: (callback: typeof result) => { result = callback; },
  };
  const input = document.getElementById('query') as HTMLInputElement;
  const focus = vi.fn(); const select = vi.fn();
  Object.assign(input, { focus, select });
  vm.runInNewContext(document.querySelector('script')!.textContent!, { document, window: { riFind: find } });
  const element = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const key = (target: EventTarget, init: { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number }) => {
    const event = Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { shiftKey: false, isComposing: false, keyCode: 0, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const type = (value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const press = (id: string, name: 'click' | 'mousedown') => {
    const event = new Event(name, { bubbles: true, cancelable: true });
    element(id).dispatchEvent(event);
    return event;
  };
  return { document, find, input, focus, select, element, key, type, press, open: (query: string) => open(query), result: (label: string) => result(label) };
}

it('is a strict local page with the shared theme and labeled controls', () => {
  const html = findBarPage('test123', { theme: 'light', platform: 'darwin' });
  expect(html).toContain(`script-src 'nonce-test123'`);
  expect(html).toContain(`default-src 'none'`);
  expect(html).toMatch(/<html lang="en" class="light" data-ri-desktop="darwin" data-ri-local-view="find">/);
  expect(html).not.toMatch(/https?:\/\//);
  const { document } = parseHTML(html);
  const copy = [...document.querySelectorAll('[aria-label],[placeholder]')].flatMap(node => [node.getAttribute('aria-label'), node.getAttribute('placeholder')]);
  expect(copy.join(' ')).not.toMatch(/[—;]/);
  expect(document.querySelector('form')!.getAttribute('role')).toBe('search');
  expect(document.getElementById('query')!.getAttribute('aria-label')).toBe('Find in page');
  expect(['previous', 'next', 'close'].map(id => document.getElementById(id)!.getAttribute('aria-label'))).toEqual(['Previous match', 'Next match', 'Close find bar']);
  expect(document.getElementById('count')!.getAttribute('aria-live')).toBe('polite');
  expect(() => findBarPage('not a nonce!')).toThrow('Invalid page nonce');
});

it('searches as the person types and moves only when there is text', () => {
  const ui = renderBar();
  expect(ui.element('previous').disabled).toBe(true);
  expect(ui.element('next').disabled).toBe(true);
  ui.key(ui.input, { key: 'Enter' });
  expect(ui.find.next).not.toHaveBeenCalled();
  ui.type('deck');
  expect(ui.find.query).toHaveBeenLastCalledWith('deck');
  expect(ui.element('next').disabled).toBe(false);
  ui.result('2 of 5');
  expect(ui.element('count').textContent).toBe('2 of 5');
  expect(ui.key(ui.input, { key: 'Enter' }).defaultPrevented).toBe(true);
  expect(ui.find.next).toHaveBeenCalledOnce();
  ui.key(ui.input, { key: 'Enter', shiftKey: true });
  expect(ui.find.previous).toHaveBeenCalledOnce();
  ui.key(ui.input, { key: 'F3' });
  ui.key(ui.input, { key: 'F3', shiftKey: true });
  expect(ui.find.next).toHaveBeenCalledTimes(2);
  expect(ui.find.previous).toHaveBeenCalledTimes(2);
  ui.press('next', 'click');
  ui.press('previous', 'click');
  expect(ui.find.next).toHaveBeenCalledTimes(3);
  expect(ui.find.previous).toHaveBeenCalledTimes(3);
  ui.type('');
  expect(ui.find.query).toHaveBeenLastCalledWith('');
  expect(ui.element('count').textContent).toBe('');
  expect(ui.element('next').disabled).toBe(true);
});

it('leaves Enter to an input method while it composes', () => {
  const ui = renderBar();
  ui.type('にほ');
  ui.key(ui.input, { key: 'Enter', isComposing: true });
  ui.key(ui.input, { key: 'Enter', keyCode: 229 });
  expect(ui.find.next).not.toHaveBeenCalled();
});

it('closes on Escape or the close button, and keeps focus in the box when a button is pressed', () => {
  const ui = renderBar();
  ui.key(ui.input, { key: 'Escape' });
  ui.key(ui.element('next'), { key: 'Escape' });
  ui.press('close', 'click');
  expect(ui.find.close).toHaveBeenCalledTimes(3);
  for (const id of ['previous', 'next', 'close']) expect(ui.press(id, 'mousedown').defaultPrevented).toBe(true);
});

it('opens on the last search, selected, so typing replaces it', () => {
  const ui = renderBar();
  ui.open('deck');
  expect(ui.input.value).toBe('deck');
  expect(ui.element('next').disabled).toBe(false);
  expect(ui.focus).toHaveBeenCalledOnce();
  expect(ui.select).toHaveBeenCalledOnce();
  expect(ui.find.query).not.toHaveBeenCalled();
  ui.open('');
  expect(ui.input.value).toBe('');
  expect(ui.element('next').disabled).toBe(true);
});
