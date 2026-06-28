import fs from 'node:fs';
import path from 'node:path';
import { getAppRoot } from '@/lib/config/paths';

export const DECK_INSTRUCTIONS_FILENAME = 'DECK.md';

/**
 * The user's deck instructions — a SOUL.md-style, user-owned file (`DECK.md` at
 * the app root) that says, in plain language, which connected sources the deck
 * should consult and how (e.g. "use my Google Calendar me@company.com for work
 * events, and Linear for task updates from my team"). Injected verbatim into
 * every deck generation so the model knows what to pull in. Returns null when
 * absent or empty — generation just proceeds with the default consult policy.
 */
export function readDeckInstructions(): string | null {
  try {
    const p = path.join(getAppRoot(), DECK_INSTRUCTIONS_FILENAME);
    if (!fs.existsSync(p)) return null;
    const content = fs.readFileSync(p, 'utf8').trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/** Largest DECK.md we'll accept from the in-app editor. */
export const DECK_INSTRUCTIONS_MAX_BYTES = 50_000;

/**
 * Write the user's deck instructions (DECK.md at the app root), creating the
 * directory if needed. Always the same fixed file — never a caller-supplied
 * path — so it's safe to drive from the in-app editor.
 */
export function writeDeckInstructions(content: string): void {
  const root = getAppRoot();
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, DECK_INSTRUCTIONS_FILENAME), content, 'utf8');
}
