import { describe, it, expect } from 'vitest';
import { resolveChromium } from './chromium';

describe('resolveChromium', () => {
  it('honors a configured path that exists', () => {
    // This test file exists, so it is a valid stand-in for a pinned binary path.
    const resolved = resolveChromium(__filename);
    expect(resolved?.executablePath).toBe(__filename);
  });

  it('ignores a configured path that does not exist and falls back to autodetect', () => {
    // Falls back to whatever is installed (or null). Either way it must not
    // return the bogus configured path.
    const resolved = resolveChromium('/definitely/not/a/real/browser/binary');
    expect(resolved?.executablePath).not.toBe('/definitely/not/a/real/browser/binary');
  });
});
