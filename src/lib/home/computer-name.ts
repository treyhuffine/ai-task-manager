/**
 * What a person calls this computer. No database access, so a connected
 * computer can use it too.
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';

/** "Mac Mini", not "AI-Mac-Mini.local": macOS's Computer Name, else the hostname. */
export function defaultComputerName(): string {
  if (process.platform === 'darwin') {
    const out = spawnSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 });
    const name = out.status === 0 ? out.stdout.trim() : '';
    if (name) return name;
  }
  return os.hostname().replace(/\.local$/, '') || 'This computer';
}

export function thisComputerFacts(): { name: string; platform: string; hostname: string } {
  return { name: defaultComputerName(), platform: process.platform, hostname: os.hostname() };
}
