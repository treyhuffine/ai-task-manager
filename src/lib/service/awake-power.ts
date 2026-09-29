import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AwakePower } from './awake-settings';

const execute = promisify(execFile);
export interface PowerSource { power: AwakePower; detail: string }

export function macPowerSource(output: string): PowerSource {
  // Only the current-source header is authoritative. Battery summaries can
  // still say "charging" just after unplugging the adapter.
  const source = output.match(/^Now drawing from '([^']+)'/m)?.[1];
  if (source === 'AC Power') return { power: 'external', detail: 'External power is connected.' };
  if (source === 'Battery Power' || source === 'UPS Power') return { power: 'battery', detail: 'Waiting for external power.' };
  return { power: 'unknown', detail: 'The current power source could not be confirmed.' };
}

export async function linuxPowerSource(directory = '/sys/class/power_supply'): Promise<PowerSource> {
  try {
    const names = await fs.readdir(directory);
    let batteries = 0;
    let online = false;
    let offline = false;
    let batteryOnAc = false;
    let discharging = false;
    let unknownSupply = false;
    for (const name of names) {
      const file = (leaf: string) => fs.readFile(path.join(directory, name, leaf), 'utf8').then(value => value.trim());
      const optional = async (leaf: string) => {
        try { return await file(leaf); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
      };
      if (await optional('scope') === 'Device') continue;
      const type = await file('type');
      if (type === 'Battery' || type === 'UPS') {
        if (await optional('present') === '0') continue;
        batteries++;
        const status = await file('status');
        discharging ||= status === 'Discharging';
        batteryOnAc ||= status === 'Charging';
      } else if (/^(Mains|USB(?:_.*)?|Wireless)$/.test(type)) {
        const value = await file('online');
        // The kernel ABI also uses 2 for online programmable supplies, such
        // as USB-PD PPS. It is connected power, not an invalid boolean.
        if (!['0', '1', '2'].includes(value)) throw new Error('Invalid power source');
        online ||= value === '1' || value === '2';
        offline ||= value === '0';
      } else unknownSupply = true;
    }
    if (discharging) return { power: 'battery', detail: 'Waiting for external power.' };
    if (unknownSupply) return { power: 'unknown', detail: 'A system power supply could not be identified.' };
    if (online || batteryOnAc) return { power: 'external', detail: 'External power is connected.' };
    if (batteries && offline) return { power: 'battery', detail: 'Waiting for external power.' };
    // A successfully read power-supply directory with no system batteries or
    // adapters is the ordinary desktop/server case, including Linux VMs.
    if (!batteries && !offline) return { power: 'external', detail: 'This computer reports no system battery.' };
    return { power: 'unknown', detail: 'The current power source could not be confirmed.' };
  } catch { return { power: 'unknown', detail: 'Linux power-source information is unavailable.' }; }
}

export async function readPowerSource(platform: NodeJS.Platform): Promise<PowerSource> {
  if (platform === 'linux') return linuxPowerSource();
  if (platform === 'darwin') {
    try {
      const { stdout } = await execute('/usr/bin/pmset', ['-g', 'batt'], { timeout: 2000, maxBuffer: 64 * 1024, env: { ...process.env, LC_ALL: 'C' } });
      return macPowerSource(stdout);
    } catch { return { power: 'unknown', detail: 'macOS power-source information is unavailable.' }; }
  }
  return { power: 'unknown', detail: 'Keep awake is available on macOS and Linux.' };
}
