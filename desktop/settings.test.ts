import { expect, it } from 'vitest';
import { desktopSettingsAction } from './settings';
it.each([null, [], 'status', {}, { type: 'status', extra: true }, { type: 'login', enabled: true, path: '/tmp/malicious' }, { type: 'login', enabled: 'true' }, { type: 'shortcut', enabled: true, accelerator: 'x'.repeat(81) }, { type: 'shortcut', enabled: true }, { type: 'quit' }])('rejects bridge requests outside the fixed preferences: %j', value => {
  expect(() => desktopSettingsAction(value)).toThrow('Invalid desktop setting');
});
it.each([{ type: 'status' }, { type: 'login', enabled: false }, { type: 'shortcut', enabled: true, accelerator: 'Control+Shift+K' }])('accepts the narrow settings action: %j', value => {
  expect(desktopSettingsAction(value)).toEqual(value);
});
