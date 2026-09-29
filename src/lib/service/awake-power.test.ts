import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { linuxPowerSource, macPowerSource } from './awake-power';
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-power-test-')); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });
function supply(name: string, values: Record<string, string>) {
  fs.mkdirSync(path.join(directory, name), { recursive: true });
  for (const [key, value] of Object.entries(values)) fs.writeFileSync(path.join(directory, name, key), value);
}
it('uses the macOS current-source header, including AC-only desktop machines', () => {
  expect(macPowerSource("Now drawing from 'AC Power'\n").power).toBe('external');
  expect(macPowerSource("Now drawing from 'Battery Power'\n99%; charging").power).toBe('battery');
  expect(macPowerSource("Now drawing from 'UPS Power'\n").power).toBe('battery');
  expect(macPowerSource('unknown or truncated output').power).toBe('unknown');
});
it('recognizes a Linux desktop with no system battery without mistaking a mouse for one', async () => {
  expect(await linuxPowerSource(directory)).toMatchObject({ power: 'external', detail: 'This computer reports no system battery.' });
  supply('mouse', { scope: 'Device', type: 'Battery', status: 'Discharging' });
  expect((await linuxPowerSource(directory)).power).toBe('external');
});
it('detects online adapters, unplugged batteries and conservative contradictory state', async () => {
  supply('AC', { type: 'Mains', online: '1' });
  supply('BAT0', { type: 'Battery', status: 'Full' });
  expect((await linuxPowerSource(directory)).power).toBe('external');
  supply('BAT0', { status: 'Discharging' });
  expect((await linuxPowerSource(directory)).power).toBe('battery');
  supply('AC', { online: '0' });
  expect((await linuxPowerSource(directory)).power).toBe('battery');
});
it('does not infer AC from a full battery or unreadable adapter information', async () => {
  supply('BAT0', { type: 'Battery', status: 'Full' });
  expect((await linuxPowerSource(directory)).power).toBe('unknown');
  supply('AC', { type: 'Mains' });
  expect((await linuxPowerSource(directory)).power).toBe('unknown');
  expect((await linuxPowerSource(path.join(directory, 'missing'))).power).toBe('unknown');
});
it('supports charging batteries and treats discharge from a UPS as battery power', async () => {
  supply('BAT0', { type: 'Battery', status: 'Charging' });
  expect((await linuxPowerSource(directory)).power).toBe('external');
  supply('UPS', { type: 'UPS', status: 'Discharging' });
  expect((await linuxPowerSource(directory)).power).toBe('battery');
});
it('recognizes an online programmable USB-PD supply', async () => {
  supply('USB', { type: 'USB', online: '2', usb_type: 'PD_PPS' });
  supply('BAT0', { type: 'Battery', status: 'Full' });
  expect((await linuxPowerSource(directory)).power).toBe('external');
  supply('USB', { online: '3' });
  expect((await linuxPowerSource(directory)).power).toBe('unknown');
});
it('never mistakes an unknown system supply for a battery-free desktop', async () => {
  supply('unknown', { type: 'Unknown', scope: 'System' });
  expect((await linuxPowerSource(directory)).power).toBe('unknown');
  supply('AC', { type: 'Mains', online: '1' });
  expect((await linuxPowerSource(directory)).power).toBe('unknown');
  supply('unknown', { scope: 'Device' });
  expect((await linuxPowerSource(directory)).power).toBe('external');
});
