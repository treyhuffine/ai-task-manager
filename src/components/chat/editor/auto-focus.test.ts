import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { scheduleEditorAutoFocus } from './auto-focus';

let document: Document;
let target: HTMLElement;
let active: Element | null;
let windowFocused: boolean;
let frame: FrameRequestCallback | undefined;
const focus = vi.fn();

beforeEach(() => {
  document = parseHTML('<!doctype html><html><body><button id="navigation">Open chat</button><div contenteditable="true"></div></body></html>').document;
  active = document.getElementById('navigation');
  windowFocused = true;
  Object.defineProperty(document, 'activeElement', { get: () => active });
  document.hasFocus = () => windowFocused;
  target = document.querySelector<HTMLElement>('[contenteditable]')!;
  target.getClientRects = () => [{}] as unknown as DOMRectList;
  frame = undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined; });
  focus.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function runFrame() { const callback = frame; frame = undefined; callback?.(16); }

it('focuses a ready editor after ordinary navigation, in one frame', () => {
  scheduleEditorAutoFocus(target, focus);
  expect(focus).not.toHaveBeenCalled();
  runFrame();
  expect(focus).toHaveBeenCalledOnce();
  expect(frame).toBeUndefined();
});

it('does not take focus from a capture textarea opened after scheduling', () => {
  scheduleEditorAutoFocus(target, focus);
  const capture = document.createElement('textarea');
  capture.value = 'My capture stays here';
  document.body.append(capture);
  active = capture;
  runFrame();
  expect(focus).not.toHaveBeenCalled();
  expect(active).toBe(capture);
  expect(capture.value).toBe('My capture stays here');
});

it.each(['input', 'textarea', 'select', 'div'])('preserves existing %s input focus while a chat finishes loading', tag => {
  const input = document.createElement(tag);
  if (tag === 'div') input.setAttribute('contenteditable', 'true');
  document.body.append(input);
  active = input;
  scheduleEditorAutoFocus(target, focus);
  runFrame();
  expect(focus).not.toHaveBeenCalled();
});

it.each(['dialog', 'alertdialog'])('yields to a %s even before its input receives focus', role => {
  scheduleEditorAutoFocus(target, focus);
  const dialog = document.createElement('div');
  dialog.setAttribute('role', role);
  dialog.getClientRects = () => [{}] as unknown as DOMRectList;
  document.body.append(dialog);
  runFrame();
  expect(focus).not.toHaveBeenCalled();
});

it('ignores closed dialogs and permits an editor inside its own dialog', () => {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.getClientRects = () => [{}] as unknown as DOMRectList;
  document.body.append(dialog);
  dialog.append(target);
  const closed = document.createElement('div');
  closed.setAttribute('role', 'dialog');
  closed.getClientRects = () => [] as unknown as DOMRectList;
  document.body.append(closed);
  scheduleEditorAutoFocus(target, focus);
  runFrame();
  expect(focus).toHaveBeenCalledOnce();
});

it('recognizes a visible search input inside a dialog wrapper with no box', () => {
  scheduleEditorAutoFocus(target, focus);
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.getClientRects = () => [] as unknown as DOMRectList;
  const search = document.createElement('input');
  search.getClientRects = () => [{}] as unknown as DOMRectList;
  dialog.append(search);
  document.body.append(dialog);
  runFrame();
  expect(focus).not.toHaveBeenCalled();
});

it('yields when the user chooses another button after scheduling', () => {
  scheduleEditorAutoFocus(target, focus);
  const other = document.createElement('button');
  document.body.append(other);
  active = other;
  runFrame();
  expect(focus).not.toHaveBeenCalled();
});

it('allows focus when the old navigation control unmounts', () => {
  scheduleEditorAutoFocus(target, focus);
  active?.remove();
  active = document.body;
  runFrame();
  expect(focus).toHaveBeenCalledOnce();
});

it.each(['hidden', 'inert', 'aria-hidden', 'disabled', 'detached', 'background'])('does not focus an editor that becomes %s', state => {
  scheduleEditorAutoFocus(target, focus);
  if (state === 'hidden') target.getClientRects = () => [] as unknown as DOMRectList;
  if (state === 'inert') target.setAttribute('inert', '');
  if (state === 'aria-hidden') document.body.setAttribute('aria-hidden', 'true');
  if (state === 'disabled') target.setAttribute('contenteditable', 'false');
  if (state === 'detached') target.remove();
  if (state === 'background') windowFocused = false;
  runFrame();
  expect(focus).not.toHaveBeenCalled();
});

it('cancels a pending frame on composer cleanup', () => {
  const cancel = scheduleEditorAutoFocus(target, focus);
  cancel();
  runFrame();
  expect(focus).not.toHaveBeenCalled();
});

it('does not disturb a selection already focused in this editor', () => {
  scheduleEditorAutoFocus(target, focus);
  active = target;
  runFrame();
  expect(focus).not.toHaveBeenCalled();
});
