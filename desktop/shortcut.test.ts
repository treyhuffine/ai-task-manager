import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CaptureShortcut, captureAccelerator } from './shortcut';
import { DEFAULT_CAPTURE_SHORTCUT } from '../src/lib/client/desktop-settings';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-shortcut-')); roots.push(root);
  const file = path.join(root, 'shortcut.json');
  const active = new Map<string, () => void>();
  const api = { register: vi.fn((key: string, callback: () => void) => { active.set(key, callback); return true; }), unregister: vi.fn((key: string) => { active.delete(key); }), isRegistered: (key: string) => active.has(key) };
  const capture = vi.fn(); const controller = new CaptureShortcut(file, api, capture);
  return { file, active, api, capture, controller };
}
it('starts opt-in, registers and persists a canonical shortcut, then releases it on stop', () => {
  const f = fixture(); expect(f.controller.start()).toMatchObject({ enabled: false, state: 'off', accelerator: DEFAULT_CAPTURE_SHORTCUT });
  expect(f.api.register).not.toHaveBeenCalled();
  expect(f.controller.configure({ enabled: true, accelerator: 'cmdorctrl+shift+k' })).toMatchObject({ state: 'active', accelerator: DEFAULT_CAPTURE_SHORTCUT });
  f.active.get(DEFAULT_CAPTURE_SHORTCUT)!(); expect(f.capture).toHaveBeenCalledOnce();
  expect(JSON.parse(fs.readFileSync(f.file, 'utf8'))).toEqual({ enabled: true, accelerator: DEFAULT_CAPTURE_SHORTCUT });
  expect(fs.statSync(f.file).mode & 0o777).toBe(0o600);
  f.controller.stop(); expect(f.active.size).toBe(0);
  expect(new CaptureShortcut(f.file, f.api, f.capture).start().state).toBe('active');
});
it('keeps the old working shortcut and saved preference when a replacement conflicts', () => {
  const f = fixture(); f.controller.start(); f.controller.configure({ enabled: true, accelerator: DEFAULT_CAPTURE_SHORTCUT });
  f.api.register.mockReturnValueOnce(false);
  expect(() => f.controller.configure({ enabled: true, accelerator: 'Control+Alt+Space' })).toThrow('could not be registered');
  expect(f.controller.status()).toMatchObject({ accelerator: DEFAULT_CAPTURE_SHORTCUT, state: 'active' });
  expect(f.active.size).toBe(1);
});
it('reports persisted shortcut conflicts honestly, supports retry and disabled persistence', () => {
  const f = fixture(); fs.writeFileSync(f.file, JSON.stringify({ enabled: true, accelerator: DEFAULT_CAPTURE_SHORTCUT }));
  f.api.register.mockReturnValueOnce(false); expect(f.controller.start().state).toBe('unavailable');
  expect(f.controller.configure({ enabled: true, accelerator: DEFAULT_CAPTURE_SHORTCUT }).state).toBe('active');
  expect(f.controller.configure({ enabled: false, accelerator: DEFAULT_CAPTURE_SHORTCUT }).state).toBe('off');
  expect(f.active.size).toBe(0);
  expect(new CaptureShortcut(f.file, f.api, f.capture).start().state).toBe('off');
});
it('does not claim a malformed preference and permits explicit repair', () => {
  const f = fixture(); fs.writeFileSync(f.file, '{broken');
  expect(f.controller.start().state).toBe('unavailable'); expect(f.active.size).toBe(0);
  expect(f.controller.configure({ enabled: false, accelerator: DEFAULT_CAPTURE_SHORTCUT }).state).toBe('off');
});
it.each(['K', 'Shift+K', 'Alt+Space', 'Command+Control+K', 'Cmd+Cmd+K', 'Control+VolumeUp', 'Control+K+garbage', '', 'Control+F25'])('refuses unintended key grabs: %s', value => {
  expect(() => captureAccelerator(value)).toThrow();
});
it('removes a newly claimed binding if saving fails and retains the previous one', () => {
  const f = fixture(); f.controller.configure({ enabled: true, accelerator: DEFAULT_CAPTURE_SHORTCUT });
  fs.unlinkSync(f.file); fs.mkdirSync(f.file);
  expect(() => f.controller.configure({ enabled: true, accelerator: 'Control+Alt+Space' })).toThrow();
  expect([...f.active.keys()]).toEqual([DEFAULT_CAPTURE_SHORTCUT]);
});
it('prepares portal identity only for an opted-in registration and retains prior state on failure', () => {
  const f = fixture(); const prepare = vi.fn();
  const controller = new CaptureShortcut(f.file, f.api, f.capture, true, prepare);
  controller.start(); controller.status();
  controller.configure({ enabled: false, accelerator: DEFAULT_CAPTURE_SHORTCUT });
  expect(prepare).not.toHaveBeenCalled();
  controller.configure({ enabled: true, accelerator: DEFAULT_CAPTURE_SHORTCUT });
  controller.configure({ enabled: true, accelerator: DEFAULT_CAPTURE_SHORTCUT });
  expect(prepare).toHaveBeenCalledOnce();
  prepare.mockImplementationOnce(() => { throw new Error('Desktop identity conflict'); });
  expect(() => controller.configure({ enabled: true, accelerator: 'Control+Alt+Space' })).toThrow('Desktop identity conflict');
  expect(f.api.register).toHaveBeenCalledOnce();
  expect(controller.status()).toMatchObject({ state: 'active', accelerator: DEFAULT_CAPTURE_SHORTCUT });
  expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).accelerator).toBe(DEFAULT_CAPTURE_SHORTCUT);
});
it('reports a saved portal setup failure without grabbing a native key', () => {
  const f = fixture(); fs.writeFileSync(f.file, JSON.stringify({ enabled: true, accelerator: DEFAULT_CAPTURE_SHORTCUT }));
  const prepare = vi.fn(() => { throw new Error('Desktop identity unavailable'); });
  const controller = new CaptureShortcut(f.file, f.api, f.capture, true, prepare);
  expect(controller.start()).toMatchObject({ enabled: true, state: 'unavailable', detail: 'Desktop identity unavailable' });
  expect(prepare).toHaveBeenCalledOnce(); expect(f.api.register).not.toHaveBeenCalled();
});
