import { afterEach, expect, it } from 'vitest';
import { _resetRemoteLive, bindDeviceMirrorEnrollment, currentRemoteSignal, mirrorSignal, remoteChat, replaceDeviceMirror } from './remote-live';
const pending = { requestId: 'prompt', sessionId: 'chat', kind: 'permission', toolName: 'fixture' } as never;
const empty = { running: [], pending: [], backgroundTasks: {} };
afterEach(_resetRemoteLive);
it('does not resurrect a crashed prompt when journal replay follows its empty live snapshot', () => {
  mirrorSignal('laptop', 'chat', { type: 'pending_input', pending }, 10);
  expect(remoteChat('chat')?.pending).toHaveLength(1);
  replaceDeviceMirror('laptop', empty, 12);
  mirrorSignal('laptop', 'chat', { type: 'pending_input', pending }, 11);
  expect(remoteChat('chat')?.pending).toHaveLength(0);
  expect(currentRemoteSignal('laptop', 12)).toBe(false);
  mirrorSignal('laptop', 'chat', { type: 'pending_input', pending }, 13);
  expect(remoteChat('chat')?.pending).toHaveLength(1);
});
it('does not let an older in-flight heartbeat wipe a newer live event', () => {
  replaceDeviceMirror('laptop', empty, 10);
  mirrorSignal('laptop', 'chat', { type: 'pending_input', pending }, 12);
  replaceDeviceMirror('laptop', empty, 11);
  expect(remoteChat('chat')?.pending).toHaveLength(1);
  replaceDeviceMirror('laptop', empty, 12);
  expect(remoteChat('chat')?.pending).toHaveLength(0);
});
it('isolates device positions and preserves protocol-4 peers without a journal report', () => {
  replaceDeviceMirror('one', empty, 100);
  mirrorSignal('two', 'chat', { type: 'pending_input', pending }, 1);
  expect(remoteChat('chat')?.pending).toHaveLength(1);
  replaceDeviceMirror('two', empty);
  mirrorSignal('two', 'chat', { type: 'pending_input', pending });
  expect(remoteChat('chat')?.pending).toHaveLength(1);
});


it('replays inventory independently of heartbeat position without replacing a newer inventory', () => {
  const inventory = { commands: [{ name: 'one' }] } as never;
  const newer = { commands: [{ name: 'two' }] } as never;
  replaceDeviceMirror('laptop', empty, 100);
  mirrorSignal('laptop', 'chat', { type: 'inventory', inventory }, 20);
  expect(remoteChat('chat')?.inventory).toBe(inventory);
  mirrorSignal('laptop', 'chat', { type: 'inventory', inventory: newer }, 30);
  mirrorSignal('laptop', 'chat', { type: 'inventory', inventory }, 25);
  expect(remoteChat('chat')?.inventory).toBe(newer);
  expect(currentRemoteSignal('laptop', 90)).toBe(false);
});
it('resets mirror ordering only for a changed authenticated enrollment', () => {
  bindDeviceMirrorEnrollment('laptop', 'old-key');
  replaceDeviceMirror('laptop', empty, 100);
  bindDeviceMirrorEnrollment('laptop', 'old-key');
  mirrorSignal('laptop', 'chat', { type: 'pending_input', pending }, 1);
  expect(remoteChat('chat')).toBeNull();
  bindDeviceMirrorEnrollment('laptop', 'new-key');
  mirrorSignal('laptop', 'chat', { type: 'pending_input', pending }, 1);
  expect(remoteChat('chat')?.pending).toHaveLength(1);
});
