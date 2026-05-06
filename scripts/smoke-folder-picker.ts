#!/usr/bin/env tsx
/**
 * Manual smoke test for the native folder picker — one of those things that
 * can't be automated because it puts a modal dialog in front of a human.
 *
 * Runs the real `pickFolder()` against the real OS dialog. Verifies:
 *   - the dialog actually opens
 *   - it appears on top of the terminal/browser (the macOS System Events
 *     activate trick / the Windows TopMost owner trick)
 *   - cancel detection works in your locale
 *   - the returned path looks right
 *
 * Usage:
 *   pnpm tsx scripts/smoke-folder-picker.ts
 *
 * The script runs three rounds — pick / cancel / pick again — so you can
 * sanity-check both code paths without re-launching.
 */

import pc from 'picocolors';
import { pickFolder } from '../src/lib/fs/native-picker';

async function round(label: string, instruction: string) {
  console.log(`\n${pc.bold(pc.cyan(label))}  ${pc.dim(instruction)}`);
  const start = Date.now();
  const result = await pickFolder(`Smoke test — ${label}`);
  const ms = Date.now() - start;

  if ('path' in result) {
    console.log(pc.green(`  picked  → ${result.path}  ${pc.dim(`(${ms}ms)`)}`));
  } else if ('cancelled' in result) {
    console.log(pc.yellow(`  cancelled  ${pc.dim(`(${ms}ms)`)}`));
  } else {
    console.log(pc.red(`  unsupported: ${result.reason}`));
  }
  return result;
}

async function main() {
  console.log(pc.bold(`Native folder picker smoke — platform: ${process.platform}`));
  console.log(pc.dim('Three rounds. Watch where the dialog appears (it should pop on top).'));

  await round('round 1 — pick anything', 'Choose a folder, then verify the path printed below.');
  await round('round 2 — cancel', 'Hit Cancel / Escape. Should print "cancelled", not throw.');
  await round('round 3 — pick again', 'Quick re-open to confirm no leftover state from the cancel.');

  console.log(pc.bold(pc.green('\nDone. If all three printed the expected outcome, the OS path works.')));
}

main().catch((err) => {
  console.error(pc.red('\nSmoke failed:'), err);
  process.exit(1);
});
