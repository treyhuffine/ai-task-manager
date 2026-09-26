import { describe, expect, it } from 'vitest';
import { portableFromPmset, portableFromPowerSupplies } from './portable';

describe('whether the home runs on a laptop (P3.4)', () => {
  it('reads a Mac battery from pmset', () => {
    expect(portableFromPmset("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=123)\t87%; discharging")).toBe(true);
    expect(portableFromPmset("Now drawing from 'AC Power'\n")).toBe(false);
  });
  it('reads a Linux battery from the power supplies', () => {
    expect(portableFromPowerSupplies(['AC', 'BAT0'])).toBe(true);
    expect(portableFromPowerSupplies(['AC', 'ucsi-source-psy-USBC000:001'])).toBe(false);
  });
});
