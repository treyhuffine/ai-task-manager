import { describe, it, expect } from 'vitest';
import { deviceKindFromUserAgent } from './device-kind';

describe('deviceKindFromUserAgent', () => {
  it('returns "other" for null/empty input', () => {
    expect(deviceKindFromUserAgent(null)).toBe('other');
    expect(deviceKindFromUserAgent(undefined)).toBe('other');
    expect(deviceKindFromUserAgent('')).toBe('other');
  });

  it('detects service/programmatic access', () => {
    expect(deviceKindFromUserAgent('curl/8.4.0')).toBe('service');
    expect(deviceKindFromUserAgent('Wget/1.21.3')).toBe('service');
    expect(deviceKindFromUserAgent('HTTPie/3.2.1')).toBe('service');
    expect(deviceKindFromUserAgent('node-fetch/1.0')).toBe('service');
    expect(deviceKindFromUserAgent('undici/6.0')).toBe('service');
    expect(deviceKindFromUserAgent('python-requests/2.31.0')).toBe('service');
    expect(deviceKindFromUserAgent('Go-http-client/1.1')).toBe('service');
  });

  it('detects phones', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    expect(deviceKindFromUserAgent(iphone)).toBe('phone');

    const androidPhone =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';
    expect(deviceKindFromUserAgent(androidPhone)).toBe('phone');
  });

  it('detects tablets', () => {
    const ipad =
      'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/604.1';
    expect(deviceKindFromUserAgent(ipad)).toBe('tablet');

    const androidTablet =
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    expect(deviceKindFromUserAgent(androidTablet)).toBe('tablet');

    const kindle = 'Mozilla/5.0 (Linux; U; Android 9; KFTRWI) Silk/122.0.0.0';
    expect(deviceKindFromUserAgent(kindle)).toBe('tablet');
  });

  it('detects devices via OS', () => {
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    expect(deviceKindFromUserAgent(mac)).toBe('computer');

    const linux =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    expect(deviceKindFromUserAgent(linux)).toBe('computer');

    const windows =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    expect(deviceKindFromUserAgent(windows)).toBe('computer');
  });

  it('falls back to "other" for unknown UAs', () => {
    expect(deviceKindFromUserAgent('SomeRandomBot/1.0')).toBe('other');
  });
});
