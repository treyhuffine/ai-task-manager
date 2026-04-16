import { describe, it, expect } from 'vitest';
import { deviceTypeFromUserAgent } from './device-type';

describe('deviceTypeFromUserAgent', () => {
  it('returns "other" for null/empty input', () => {
    expect(deviceTypeFromUserAgent(null)).toBe('other');
    expect(deviceTypeFromUserAgent(undefined)).toBe('other');
    expect(deviceTypeFromUserAgent('')).toBe('other');
  });

  it('detects CLI tooling', () => {
    expect(deviceTypeFromUserAgent('curl/8.4.0')).toBe('cli');
    expect(deviceTypeFromUserAgent('Wget/1.21.3')).toBe('cli');
    expect(deviceTypeFromUserAgent('HTTPie/3.2.1')).toBe('cli');
    expect(deviceTypeFromUserAgent('node-fetch/1.0')).toBe('cli');
    expect(deviceTypeFromUserAgent('undici/6.0')).toBe('cli');
    expect(deviceTypeFromUserAgent('python-requests/2.31.0')).toBe('cli');
    expect(deviceTypeFromUserAgent('Go-http-client/1.1')).toBe('cli');
  });

  it('detects phones', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    expect(deviceTypeFromUserAgent(iphone)).toBe('phone');

    const androidPhone =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';
    expect(deviceTypeFromUserAgent(androidPhone)).toBe('phone');
  });

  it('detects tablets', () => {
    const ipad =
      'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/604.1';
    expect(deviceTypeFromUserAgent(ipad)).toBe('tablet');

    const androidTablet =
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    expect(deviceTypeFromUserAgent(androidTablet)).toBe('tablet');

    const kindle = 'Mozilla/5.0 (Linux; U; Android 9; KFTRWI) Silk/122.0.0.0';
    expect(deviceTypeFromUserAgent(kindle)).toBe('tablet');
  });

  it('detects laptop/desktop via OS', () => {
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    expect(deviceTypeFromUserAgent(mac)).toBe('laptop');

    const linux =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    expect(deviceTypeFromUserAgent(linux)).toBe('laptop');

    const windows =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    expect(deviceTypeFromUserAgent(windows)).toBe('desktop');
  });

  it('falls back to "other" for unknown UAs', () => {
    expect(deviceTypeFromUserAgent('SomeRandomBot/1.0')).toBe('other');
  });
});
