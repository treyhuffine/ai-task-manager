import { afterEach, expect, it } from 'vitest';
import { terminalsInUse } from './in-use';

const global = globalThis as { __ptyRegistry?: unknown };
const saved = global.__ptyRegistry;
afterEach(() => { global.__ptyRegistry = saved; });
const terminal = (process: string, viewers = 0, exited = false) => ({ exited, shell: '/bin/zsh', proc: { process }, listeners: new Set(Array.from({ length: viewers }, () => () => {})) });

it('counts a terminal a window shows, or one running a command nobody is watching', () => {
  global.__ptyRegistry = { terminals: new Map([
    ['shown', terminal('zsh', 1)],
    ['a long job, walked away from', terminal('npm')],
    ['an idle shell, forgotten', terminal('zsh')],
    ['finished', terminal('zsh', 1, true)],
  ]) };
  expect(terminalsInUse()).toBe(2);
});

it('does not count a terminal it cannot read', () => {
  const closing = { ...terminal('zsh'), proc: { get process(): string { throw new Error('closed'); } } };
  global.__ptyRegistry = { terminals: new Map([['closing', closing]]) };
  expect(terminalsInUse()).toBe(0);
});

it('is zero before any terminal exists', () => {
  global.__ptyRegistry = undefined;
  expect(terminalsInUse()).toBe(0);
});
