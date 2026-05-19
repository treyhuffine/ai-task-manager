import { describe, it, expect } from 'vitest';
import { PortDetector } from './detect-port';

const samples: ReadonlyArray<{ name: string; banner: string; port: number }> = [
  { name: 'Vite',     banner: '  Local:   http://localhost:5173/',                    port: 5173 },
  { name: 'Next',     banner: '▲ Next.js 15.x - Local:        http://localhost:3000', port: 3000 },
  { name: 'Flask',    banner: ' * Running on http://127.0.0.1:5000',                   port: 5000 },
  { name: 'Rails',    banner: 'Listening on http://127.0.0.1:3000',                    port: 3000 },
  { name: 'Phoenix',  banner: '[info] Access LiveDashboardWeb at http://localhost:4000', port: 4000 },
  { name: 'axum',     banner: 'listening on 127.0.0.1:3000',                            port: 3000 },
  { name: 'static',   banner: 'Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...', port: 8000 },
  { name: 'Astro',    banner: 'Local    http://localhost:4321/',                        port: 4321 },
  { name: 'Storybook', banner: 'Storybook 7.6.7 for react-vite started on http://localhost:6006/', port: 6006 },
  { name: 'IPv6',     banner: 'serving at http://[::1]:7890/',                          port: 7890 },
];

describe('PortDetector', () => {
  for (const { name, banner, port } of samples) {
    it(`detects ${name}`, () => {
      const d = new PortDetector();
      const got = d.feedAndCheck(banner + '\n');
      expect(got).toBe(port);
      expect(d.port()).toBe(port);
    });
  }

  it('handles chunks split mid-line', () => {
    const d = new PortDetector();
    expect(d.feedAndCheck('  Local: http://local')).toBeNull();
    expect(d.feedAndCheck('host:5173/\n')).toBe(5173);
  });

  it('ignores ports below 1024 and above 65535', () => {
    const d = new PortDetector();
    expect(d.feedAndCheck('Listening on http://localhost:80/')).toBeNull();
    expect(d.feedAndCheck('Listening on http://localhost:99999/')).toBeNull();
  });

  it('ignores ports in the ignorePorts set', () => {
    const d = new PortDetector({ ignorePorts: new Set([4224]) });
    expect(d.feedAndCheck('Connected to http://localhost:4224/ ready at http://localhost:3000/')).toBe(3000);
  });

  it('does not match bare :PORT without a host token', () => {
    const d = new PortDetector();
    expect(d.feedAndCheck('version 1.2.3:5000')).toBeNull();
  });

  it('latches on first match; later chunks are no-ops', () => {
    const d = new PortDetector();
    expect(d.feedAndCheck('http://localhost:3000/')).toBe(3000);
    expect(d.feedAndCheck('Restart on http://localhost:4000/')).toBeNull();
    expect(d.port()).toBe(3000);
  });

  it('accepts Buffer input', () => {
    const d = new PortDetector();
    expect(d.feedAndCheck(Buffer.from('Ready: http://127.0.0.1:8080\n'))).toBe(8080);
  });

  it('reset clears resolved state', () => {
    const d = new PortDetector();
    d.feedAndCheck('http://localhost:3000');
    d.reset();
    expect(d.port()).toBeNull();
    expect(d.feedAndCheck('http://localhost:5000')).toBe(5000);
  });

  it('set forces a port and short-circuits future feeds', () => {
    const d = new PortDetector();
    d.set(9999);
    expect(d.port()).toBe(9999);
    expect(d.feedAndCheck('http://localhost:3000')).toBeNull();
    expect(d.port()).toBe(9999);
  });
});
