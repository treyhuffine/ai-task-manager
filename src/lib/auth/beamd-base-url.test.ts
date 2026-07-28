import { describe, expect, it } from 'vitest';
import { isValidPreviewLabel, MAX_LABEL_LENGTH } from '@/lib/preview/preview-name';
import {
  defaultBeamdTunnelName,
  normalizeTunnelName,
  resolveBeamdTunnelName,
} from './beamd-base-url';

describe('defaultBeamdTunnelName', () => {
  it('uses the app short id as the stable production tunnel name', () => {
    expect(defaultBeamdTunnelName('production')).toBe('flow');
  });

  it('suffixes the app short id in development', () => {
    expect(defaultBeamdTunnelName('development')).toBe('flow-dev');
  });

  it('keeps the name valid for beamd', () => {
    const name = defaultBeamdTunnelName('development');
    expect(name.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
    expect(isValidPreviewLabel(name)).toBe(true);
  });
});

describe('normalizeTunnelName', () => {
  it('trims and lowercases', () => {
    expect(normalizeTunnelName('  Flow-Laptop \n')).toBe('flow-laptop');
  });

  it('leaves invalid characters alone so validation can reject them', () => {
    // Mangling into a different hostname than the user typed is worse than
    // an error — the resolver drops the override instead.
    expect(normalizeTunnelName('flow.laptop')).toBe('flow.laptop');
  });
});

describe('resolveBeamdTunnelName', () => {
  it('falls back to the default when there is no override', () => {
    expect(resolveBeamdTunnelName(null, 'production')).toBe('flow');
    expect(resolveBeamdTunnelName('', 'production')).toBe('flow');
    expect(resolveBeamdTunnelName(undefined, 'development')).toBe('flow-dev');
  });

  it('uses a valid override verbatim, in every environment', () => {
    expect(resolveBeamdTunnelName('flow-trey-laptop', 'production')).toBe('flow-trey-laptop');
    expect(resolveBeamdTunnelName('flow-trey-laptop', 'development')).toBe('flow-trey-laptop');
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(resolveBeamdTunnelName('  Flow-Trey  ', 'production')).toBe('flow-trey');
  });

  it('ignores overrides that are not valid DNS labels', () => {
    for (const bad of ['flow.trey', 'flow trey', '-flow', 'flow-', 'flow_trey', 'x'.repeat(64)]) {
      expect(resolveBeamdTunnelName(bad, 'production')).toBe('flow');
    }
  });

  it('always resolves to something beamd will accept', () => {
    for (const candidate of [null, 'ok-name', 'BAD NAME', 'x'.repeat(200)]) {
      expect(isValidPreviewLabel(resolveBeamdTunnelName(candidate, 'production'))).toBe(true);
    }
  });
});
