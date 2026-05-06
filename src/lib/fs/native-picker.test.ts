/**
 * Tests the parsing and branching logic in native-picker. Mocks `execFile`
 * via the `util.promisify.custom` symbol so the module's top-level
 * `promisify(execFile)` resolves to our test double.
 *
 * What this catches: cancel detection per platform, tool fallback order on
 * Linux, prompt escaping, error pass-through. What it can't catch: whether
 * the dialog actually opens, whether it appears on top, TCC permissions —
 * those need the real OS. See scripts/smoke-folder-picker.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so vi.mock factory can close over it.
const mockExec = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => {
  // The module does `promisify(execFile)` at load time. Setting the
  // util.promisify.custom symbol makes promisify return our mock directly,
  // sidestepping the callback/promise dance.
  const execFile = ((..._args: unknown[]) => {
    throw new Error('test should call the promisified form');
  }) as unknown as Record<symbol, typeof mockExec>;
  execFile[Symbol.for('nodejs.util.promisify.custom')] = mockExec;
  return { execFile };
});

import { pickFolder } from './native-picker';

const originalPlatform = process.platform;
const originalDesktop = process.env.XDG_CURRENT_DESKTOP;

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

beforeEach(() => {
  mockExec.mockReset();
});

afterEach(() => {
  setPlatform(originalPlatform);
  if (originalDesktop === undefined) delete process.env.XDG_CURRENT_DESKTOP;
  else process.env.XDG_CURRENT_DESKTOP = originalDesktop;
});

/** Build an error shaped like what `execFile`'s promisified form rejects with. */
function execError(opts: { code?: number | string; stderr?: string; message?: string }) {
  return Object.assign(new Error(opts.message ?? 'execFile failed'), {
    code: opts.code,
    stderr: opts.stderr ?? '',
  });
}

describe('pickFolder — macOS', () => {
  beforeEach(() => setPlatform('darwin'));

  it('returns the picked path with trailing slash stripped', async () => {
    mockExec.mockResolvedValue({ stdout: '/Users/me/projects/foo/\n', stderr: '' });
    const result = await pickFolder('Pick one');
    expect(result).toEqual({ path: '/Users/me/projects/foo' });
  });

  it('treats AppleScript error -128 as cancel (locale-independent)', async () => {
    mockExec.mockRejectedValue(
      execError({ code: 1, stderr: 'execution error: User canceled. (-128)' }),
    );
    expect(await pickFolder('Pick')).toEqual({ cancelled: true });
  });

  it('treats -128 as cancel even when the localized message differs', async () => {
    // Simulate a French locale: "L'utilisateur a annulé." with the -128 code.
    mockExec.mockRejectedValue(
      execError({ code: 1, stderr: "execution error: L'utilisateur a annulé. (-128)" }),
    );
    expect(await pickFolder('Pick')).toEqual({ cancelled: true });
  });

  it('rethrows real osascript errors (no -128 in stderr)', async () => {
    mockExec.mockRejectedValue(execError({ code: 1, stderr: 'syntax error: something else' }));
    await expect(pickFolder('Pick')).rejects.toThrow();
  });

  it('escapes quotes, backslashes, and newlines in the prompt', async () => {
    mockExec.mockResolvedValue({ stdout: '/tmp\n', stderr: '' });
    await pickFolder('Pick "this"\\that\nplease');
    const args = mockExec.mock.calls[0][1] as string[];
    const script = args[1];
    // The prompt as it appears inside the AppleScript string literal:
    expect(script).toContain('Pick \\"this\\"\\\\that please');
    // Newlines flattened so the `-e` script stays valid AppleScript.
    expect(script).not.toContain('Pick "this"\\that\nplease');
  });
});

describe('pickFolder — Linux', () => {
  beforeEach(() => setPlatform('linux'));

  it('tries zenity first on non-KDE desktops', async () => {
    process.env.XDG_CURRENT_DESKTOP = 'GNOME';
    mockExec.mockResolvedValue({ stdout: '/home/me/proj\n', stderr: '' });
    await pickFolder('Pick');
    expect(mockExec.mock.calls[0][0]).toBe('zenity');
  });

  it('tries kdialog first on KDE', async () => {
    process.env.XDG_CURRENT_DESKTOP = 'KDE';
    mockExec.mockResolvedValue({ stdout: '/home/me/proj\n', stderr: '' });
    await pickFolder('Pick');
    expect(mockExec.mock.calls[0][0]).toBe('kdialog');
  });

  it('falls back to the other tool when the first is not installed (ENOENT)', async () => {
    process.env.XDG_CURRENT_DESKTOP = 'GNOME';
    mockExec
      .mockRejectedValueOnce(execError({ code: 'ENOENT' }))
      .mockResolvedValueOnce({ stdout: '/home/me/proj\n', stderr: '' });
    const result = await pickFolder('Pick');
    expect(result).toEqual({ path: '/home/me/proj' });
    expect(mockExec.mock.calls[0][0]).toBe('zenity');
    expect(mockExec.mock.calls[1][0]).toBe('kdialog');
  });

  it('treats exit code 1 on the first tool as cancel — does NOT fall through', async () => {
    process.env.XDG_CURRENT_DESKTOP = 'GNOME';
    mockExec.mockRejectedValueOnce(execError({ code: 1 }));
    const result = await pickFolder('Pick');
    expect(result).toEqual({ cancelled: true });
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('returns unsupported when neither tool is installed', async () => {
    delete process.env.XDG_CURRENT_DESKTOP;
    mockExec
      .mockRejectedValueOnce(execError({ code: 'ENOENT' }))
      .mockRejectedValueOnce(execError({ code: 'ENOENT' }));
    const result = await pickFolder('Pick');
    expect(result).toMatchObject({ unsupported: true });
  });

  it('rethrows non-cancel non-ENOENT errors instead of swallowing them', async () => {
    process.env.XDG_CURRENT_DESKTOP = 'GNOME';
    mockExec.mockRejectedValue(execError({ code: 2, message: 'unexpected zenity failure' }));
    await expect(pickFolder('Pick')).rejects.toThrow('unexpected zenity failure');
  });
});

describe('pickFolder — Windows', () => {
  beforeEach(() => setPlatform('win32'));

  it('returns the selected path on success', async () => {
    mockExec.mockResolvedValue({ stdout: 'C:\\Users\\me\\projects\\foo\r\n', stderr: '' });
    expect(await pickFolder('Pick')).toEqual({ path: 'C:\\Users\\me\\projects\\foo' });
  });

  it('treats empty stdout as cancel', async () => {
    mockExec.mockResolvedValue({ stdout: '\r\n', stderr: '' });
    expect(await pickFolder('Pick')).toEqual({ cancelled: true });
  });

  it('passes -STA so the script works under PowerShell 7+ (MTA by default)', async () => {
    mockExec.mockResolvedValue({ stdout: 'C:\\foo\n', stderr: '' });
    await pickFolder('Pick');
    const args = mockExec.mock.calls[0][1] as string[];
    expect(args).toContain('-STA');
  });

  it('uses a topmost owner form so the dialog appears above the browser', async () => {
    mockExec.mockResolvedValue({ stdout: 'C:\\foo\n', stderr: '' });
    await pickFolder('Pick');
    const args = mockExec.mock.calls[0][1] as string[];
    const script = args[args.length - 1];
    expect(script).toMatch(/TopMost\s*=\s*\$true/);
    expect(script).toMatch(/ShowDialog\(\$owner\)/);
  });

  it("escapes single quotes in the prompt by doubling (PowerShell '' convention)", async () => {
    mockExec.mockResolvedValue({ stdout: 'C:\\foo\n', stderr: '' });
    await pickFolder("Bob's folder");
    const script = (mockExec.mock.calls[0][1] as string[]).at(-1)!;
    expect(script).toContain("'Bob''s folder'");
  });
});

describe('pickFolder — unsupported platform', () => {
  it('returns unsupported with the platform name in the reason', async () => {
    setPlatform('freebsd' as NodeJS.Platform);
    const result = await pickFolder('Pick');
    expect(result).toMatchObject({ unsupported: true, reason: expect.stringContaining('freebsd') });
  });
});
