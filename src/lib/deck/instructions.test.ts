import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { readDeckInstructions, writeDeckInstructions, DECK_INSTRUCTIONS_FILENAME } from './instructions';

const ROOT = path.join(os.tmpdir(), `flow-deck-instr-${process.pid}`);
const prevRoot = process.env[APP_ROOT_ENV];

beforeEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  process.env[APP_ROOT_ENV] = ROOT;
});

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env[APP_ROOT_ENV];
  else process.env[APP_ROOT_ENV] = prevRoot;
});

function writeInstructions(body: string) {
  fs.writeFileSync(path.join(ROOT, DECK_INSTRUCTIONS_FILENAME), body);
}

describe('readDeckInstructions', () => {
  it('reads the instructions file from the app root', () => {
    writeInstructions('# Deck sources\nUse my Google Calendar me@company.com.');
    expect(readDeckInstructions()).toBe('# Deck sources\nUse my Google Calendar me@company.com.');
  });

  it('returns null when the file is absent', () => {
    expect(readDeckInstructions()).toBeNull();
  });

  it('returns null when the file is empty / whitespace-only', () => {
    writeInstructions('   \n  \t');
    expect(readDeckInstructions()).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    writeInstructions('\n\n  use my calendar  \n\n');
    expect(readDeckInstructions()).toBe('use my calendar');
  });

  // Tripwire: the deck flow keys on this exact filename at the app root. If you
  // rename it, this fails on purpose — update it consciously and make sure every
  // reader of the file uses DECK_INSTRUCTIONS_FILENAME (not a hardcoded string).
  it('pins the instructions filename', () => {
    expect(DECK_INSTRUCTIONS_FILENAME).toBe('DECK.md');
  });
});

describe('writeDeckInstructions', () => {
  it('writes DECK.md and reads back the same content (in-app editor round-trip)', () => {
    writeDeckInstructions('# Deck sources\nUse my calendar.');
    expect(fs.existsSync(path.join(ROOT, DECK_INSTRUCTIONS_FILENAME))).toBe(true);
    expect(readDeckInstructions()).toBe('# Deck sources\nUse my calendar.');
  });

  it('creates the app-root directory if it is missing', () => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    writeDeckInstructions('hello');
    expect(readDeckInstructions()).toBe('hello');
  });

  it('overwrites prior content', () => {
    writeDeckInstructions('first');
    writeDeckInstructions('second');
    expect(readDeckInstructions()).toBe('second');
  });
});
