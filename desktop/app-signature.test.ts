import { describe, expect, it, vi } from 'vitest';
import type { execFile } from 'node:child_process';
import { appleSigned, hasAppleSignature } from './app-signature';

// Recorded from the packaged unsigned Ri.app and from a Developer ID build.
const linkerSigned = 'Executable=/Applications/Ri.app/Contents/MacOS/Ri\nIdentifier=Electron\nSignature=adhoc\nInfo.plist=not bound\nTeamIdentifier=not set\nSealed Resources=none';
const adhoc = 'Identifier=app.ri.desktop\nSignature=adhoc\nInfo.plist entries=33\nTeamIdentifier=not set\nSealed Resources version=2 rules=13 files=15';
const developerId = 'Identifier=app.ri.desktop\nAuthority=Developer ID Application: Example (ABCDE12345)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTeamIdentifier=ABCDE12345';

describe('hasAppleSignature', () => {
  it('accepts only a signature with a Team ID', () => {
    expect(hasAppleSignature(developerId)).toBe(true);
    expect(hasAppleSignature(linkerSigned)).toBe(false);
    expect(hasAppleSignature(adhoc)).toBe(false);
    expect(hasAppleSignature('code object is not signed at all')).toBe(false);
  });
});

describe('appleSigned', () => {
  const runner = (error: Error | null, stderr: string) =>
    vi.fn((_file: string, _args: string[], _options: object, done: (e: Error | null, out: string, err: string) => void) => done(error, '', stderr)) as unknown as typeof execFile;

  it('reads codesign’s description of the bundle, which it prints to stderr', async () => {
    const run = runner(null, developerId);
    expect(await appleSigned('/Applications/Ri.app', run)).toBe(true);
    expect(run).toHaveBeenCalledWith('/usr/bin/codesign', ['-dv', '--verbose=2', '/Applications/Ri.app'], { timeout: 10_000 }, expect.any(Function));
    expect(await appleSigned('/Applications/Ri.app', runner(null, linkerSigned))).toBe(false);
  });

  it('counts a failure to read the signature as unsigned', async () => {
    expect(await appleSigned('/Applications/Ri.app', runner(new Error('not signed'), developerId))).toBe(false);
  });
});
