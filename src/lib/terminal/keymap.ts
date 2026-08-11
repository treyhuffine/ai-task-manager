/**
 * Mac terminal keybindings that xterm.js doesn't ship.
 *
 * xterm's built-in evaluator (`common/input/Keyboard.ts`) leaves three
 * combos in a state that reads as broken to anyone coming from iTerm2 or
 * Terminal.app:
 *
 *   - **Cmd+Backspace** has no `metaKey` branch, so it falls through to a
 *     plain `DEL` and deletes a single character instead of the line.
 *   - **Cmd+arrow** hits an explicit `if (ev.metaKey) break;` and emits
 *     nothing at all, so the keys are simply dead.
 *   - **Option+arrow** emits `ESC [1;3D` / `ESC [1;3C`, which neither bash
 *     readline nor zsh binds by default. Readline can't match the sequence,
 *     rings the bell, and drops the tail into the buffer as literal text —
 *     so pressing Option+Left actually types `;3D` into your command.
 *
 * The fix is to emit what the shells already bind. `ESC b` / `ESC f` are
 * `backward-word` / `forward-word` in both bash and zsh out of the box, and
 * `C0.NAK` / `C0.VT` / `C0.SOH` / `C0.ENQ` are the readline defaults that
 * Terminal.app's own Cmd bindings are built on.
 *
 * Everything else is deliberately left to xterm. Option+Backspace already
 * emits `ESC DEL` (delete-word-backward) correctly, and Ctrl is sacred in a
 * terminal — Ctrl+C must stay SIGINT, Ctrl+A must stay beginning-of-line —
 * so nothing here ever matches on `ctrlKey`.
 */

/** The subset of `KeyboardEvent` this module reads. */
export interface TerminalKeyEvent {
  key: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

// C0 control codes, named so the intent survives a grep.
const SOH = '\x01'; // Ctrl+A — beginning-of-line
const ENQ = '\x05'; // Ctrl+E — end-of-line
const VT = '\x0b'; // Ctrl+K — kill-line (cursor to end)
const NAK = '\x15'; // Ctrl+U — kill line (cursor to start)
const ESC = '\x1b';

/**
 * Cmd+<key>, macOS only.
 *
 * Gated on the platform because `metaKey` is the Super/Windows key
 * elsewhere, where these combos belong to the window manager — claiming
 * Super+Left would break OS window snapping to add a binding no non-Mac
 * user is reaching for.
 */
const META_KEYS: Record<string, string> = {
  ArrowLeft: SOH,
  ArrowRight: ENQ,
  Backspace: NAK,
  Delete: VT,
};

/**
 * Option+<key>. Not platform-gated: on Linux and Windows `altKey` is the
 * conventional Meta prefix, and `ESC b` / `ESC f` is exactly what Meta+b /
 * Meta+f sends there — so the same mapping is correct on every platform.
 */
const ALT_KEYS: Record<string, string> = {
  ArrowLeft: `${ESC}b`,
  ArrowRight: `${ESC}f`,
};

/**
 * Bytes to send for a keydown, or `null` to let xterm handle it.
 *
 * Matches on an exact modifier set. A stray Shift or Ctrl means the user is
 * reaching for something else (selection, a shell control code), and
 * guessing at those is how you end up with the bug this module exists to
 * fix.
 */
export function resolveTerminalKey(
  event: TerminalKeyEvent,
  isMac: boolean,
): string | null {
  if (event.ctrlKey || event.shiftKey) return null;

  if (event.metaKey && !event.altKey) {
    if (!isMac) return null;
    return META_KEYS[event.key] ?? null;
  }

  if (event.altKey && !event.metaKey) {
    return ALT_KEYS[event.key] ?? null;
  }

  return null;
}

/** True when the current platform treats Cmd as the terminal modifier. */
export function detectIsMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  // `userAgentData.platform` is the non-deprecated read; `platform` is the
  // fallback for Safari and Firefox, which still don't ship the former.
  const uaPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  return /mac/i.test(uaPlatform || navigator.platform || '');
}
