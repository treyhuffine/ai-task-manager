import { describe, expect, it } from 'vitest';
import { isValidPreviewLabel, MAX_LABEL_LENGTH } from '@/lib/preview/preview-name';
import {
  defaultBeamdTunnelName,
  normalizeTunnelName,
  resolveBeamdTunnelName,
  teamBeamdTunnelName,
} from './beamd-base-url';

describe('teamBeamdTunnelName', () => {
  it("names a team's address after its first name and its creation, never the personal default", () => {
    const name = teamBeamdTunnelName({ name: 'Family', creationId: '6f1c2d3e-aa10-4b6e-9d2f-0c4b5e7a9f3a' });
    expect(name).toBe('ri-family-9f3a');
    expect(name).not.toBe(defaultBeamdTunnelName('production'));
    expect(isValidPreviewLabel(name)).toBe(true);
  });

  it('keeps two teams with one name apart, and any name valid for beamd', () => {
    expect(teamBeamdTunnelName({ name: 'Acme', creationId: 'a-0001' })).not.toBe(teamBeamdTunnelName({ name: 'Acme', creationId: 'b-0002' }));
    const long = teamBeamdTunnelName({ name: 'The Very Long Name Of A Neighborhood Gardening Club & Friends', creationId: 'x'.repeat(36) });
    expect(long.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
    expect(isValidPreviewLabel(long)).toBe(true);
  });
});

describe('defaultBeamdTunnelName', () => {
  it('uses the app short id as the stable production tunnel name', () => {
    expect(defaultBeamdTunnelName('production')).toBe('ri');
  });

  it('suffixes the app short id in development', () => {
    expect(defaultBeamdTunnelName('development')).toBe('ri-dev');
  });

  it('keeps the name valid for beamd', () => {
    const name = defaultBeamdTunnelName('development');
    expect(name.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
    expect(isValidPreviewLabel(name)).toBe(true);
  });
});

describe('normalizeTunnelName', () => {
  it('trims and lowercases', () => {
    expect(normalizeTunnelName('  Ri-Laptop \n')).toBe('ri-laptop');
  });

  it('leaves invalid characters alone so validation can reject them', () => {
    // Mangling into a different hostname than the user typed is worse than
    // an error — the resolver drops the override instead.
    expect(normalizeTunnelName('ri.laptop')).toBe('ri.laptop');
  });
});

describe('resolveBeamdTunnelName', () => {
  it('falls back to the default when there is no override', () => {
    expect(resolveBeamdTunnelName(null, 'production')).toBe('ri');
    expect(resolveBeamdTunnelName('', 'production')).toBe('ri');
    expect(resolveBeamdTunnelName(undefined, 'development')).toBe('ri-dev');
  });

  it('uses a valid override verbatim, in every environment', () => {
    expect(resolveBeamdTunnelName('ri-trey-laptop', 'production')).toBe('ri-trey-laptop');
    expect(resolveBeamdTunnelName('ri-trey-laptop', 'development')).toBe('ri-trey-laptop');
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(resolveBeamdTunnelName('  Ri-Trey  ', 'production')).toBe('ri-trey');
  });

  it('ignores overrides that are not valid DNS labels', () => {
    for (const bad of ['ri.trey', 'ri trey', '-ri', 'ri-', 'ri_trey', 'x'.repeat(64)]) {
      expect(resolveBeamdTunnelName(bad, 'production')).toBe('ri');
    }
  });

  it('always resolves to something beamd will accept', () => {
    for (const candidate of [null, 'ok-name', 'BAD NAME', 'x'.repeat(200)]) {
      expect(isValidPreviewLabel(resolveBeamdTunnelName(candidate, 'production'))).toBe(true);
    }
  });
});
