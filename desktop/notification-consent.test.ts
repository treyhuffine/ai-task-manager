import { describe, expect, it, vi } from 'vitest';
import { remoteNotificationChanges } from './notification-consent';

function fixture(answer: boolean | Promise<boolean> = true) {
  let permitted = false;
  const confirm = vi.fn(async () => answer);
  const change = vi.fn(async (kind: 'enable' | 'disable' | 'test') => {
    if (kind !== 'test') permitted = kind === 'enable';
    return { supported: true, enabled: permitted };
  });
  const status = vi.fn(async () => ({ supported: true, enabled: permitted }));
  const changes = remoteNotificationChanges({ confirm, permitted: () => permitted, change, status });
  return { changes, confirm, change, status, permit: () => { permitted = true; } };
}

describe('remote notification changes', () => {
  it('turns notifications on only after the person allows it in the native dialog', async () => {
    const f = fixture(true);
    expect(await f.changes('enable')).toEqual({ supported: true, enabled: true });
    expect(f.confirm).toHaveBeenCalledTimes(1);
    expect(f.change).toHaveBeenCalledWith('enable');
  });

  it('changes nothing when the person cancels, or the dialog fails', async () => {
    for (const answer of [false, Promise.reject(new Error('window closed'))]) {
      const f = fixture(answer);
      expect(await f.changes('enable')).toEqual({ supported: true, enabled: false });
      expect(f.change).not.toHaveBeenCalled();
    }
  });

  it('shows one dialog for requests that arrive while it is open', async () => {
    let allow!: (value: boolean) => void;
    const f = fixture(new Promise<boolean>(resolve => { allow = resolve; }));
    const first = f.changes('enable');
    const second = f.changes('enable');
    allow(true);
    await Promise.all([first, second]);
    expect(f.confirm).toHaveBeenCalledTimes(1);
  });

  it('does not ask again once consent is given', async () => {
    const f = fixture();
    f.permit();
    await f.changes('enable');
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.change).toHaveBeenCalledWith('enable');
  });

  it('turns off without asking, and tests only after consent', async () => {
    const f = fixture();
    await expect(f.changes('test')).rejects.toThrow('Turn on desktop notifications on this computer first.');
    await f.changes('disable');
    expect(f.confirm).not.toHaveBeenCalled();
    f.permit();
    await f.changes('test');
    expect(f.change).toHaveBeenCalledWith('test');
  });

  it('reads status without asking', async () => {
    const f = fixture();
    await f.changes('status');
    expect(f.status).toHaveBeenCalled();
    expect(f.confirm).not.toHaveBeenCalled();
  });
});
