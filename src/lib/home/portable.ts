/**
 * Whether the home's computer is a laptop: whether it has a battery (spec §7,
 * P3.4). A home on a laptop runs its schedules only while the laptop is
 * awake, and the schedule screens say so. It explains the one scheduler
 * there is, and adds nothing to it.
 *
 * Read once per process: a computer doesn't grow or lose a battery.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);
let cached: Promise<boolean> | null = null;

/** `pmset -g batt` lists an InternalBattery on a Mac that has one. */
export function portableFromPmset(output: string): boolean {
  return /InternalBattery/.test(output);
}

/** Linux lists each battery as BAT0, BAT1… in its power supplies. */
export function portableFromPowerSupplies(names: string[]): boolean {
  return names.some((n) => /^BAT\d*$/i.test(n));
}

async function detect(): Promise<boolean> {
  try {
    if (process.platform === 'darwin') return portableFromPmset((await run('pmset', ['-g', 'batt'])).stdout);
    if (process.platform === 'linux') return portableFromPowerSupplies(fs.readdirSync('/sys/class/power_supply'));
  } catch {
    /* can't tell: say nothing rather than guess */
  }
  return false;
}

export function hostIsPortable(): Promise<boolean> {
  cached ??= detect();
  return cached;
}
