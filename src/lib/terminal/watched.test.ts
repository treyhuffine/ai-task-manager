import { afterEach, expect, it } from 'vitest';
import { watchedTerminals } from './watched';

const global = globalThis as { __ptyRegistry?: unknown };
const saved = global.__ptyRegistry;
afterEach(() => { global.__ptyRegistry = saved; });

it('counts a terminal only while a window shows it and its shell lives', () => {
  global.__ptyRegistry = { terminals: new Map([
    ['shown', { exited: false, listeners: new Set([() => {}]) }],
    ['left open, nobody watching', { exited: false, listeners: new Set() }],
    ['finished', { exited: true, listeners: new Set([() => {}]) }],
  ]) };
  expect(watchedTerminals()).toBe(1);
});

it('is zero before any terminal exists', () => {
  global.__ptyRegistry = undefined;
  expect(watchedTerminals()).toBe(0);
});
