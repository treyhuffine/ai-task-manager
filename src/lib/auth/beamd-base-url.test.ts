import { describe, expect, it } from 'vitest';
import { isValidPreviewLabel, MAX_LABEL_LENGTH } from '@/lib/preview/preview-name';
import { appBeamdTunnelName } from './beamd-base-url';

describe('appBeamdTunnelName', () => {
  it('uses the app short id as the stable production tunnel name', () => {
    expect(appBeamdTunnelName('production')).toBe('flow');
  });

  it('suffixes the app short id in development', () => {
    expect(appBeamdTunnelName('development')).toBe('flow-dev');
  });

  it('keeps the name valid for beamd', () => {
    const name = appBeamdTunnelName('development');
    expect(name.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
    expect(isValidPreviewLabel(name)).toBe(true);
  });
});
