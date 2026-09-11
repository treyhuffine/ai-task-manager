import { describe, expect, it } from 'vitest';
import { tunnelHostPreview } from './tunnel-host';

describe('tunnelHostPreview', () => {
  it('swaps the name on a flat edge', () => {
    expect(tunnelHostPreview('https://ri.beamd.run', 'ri', 'ri-laptop')).toBe(
      'https://ri-laptop.beamd.run',
    );
  });

  it('keeps the account suffix on a suffixed edge', () => {
    // `ri-dev` opened on account `acme` is served at ri-dev-acme.beamd.run.
    expect(tunnelHostPreview('https://ri-dev-acme.beamd.run', 'ri-dev', 'ri-laptop')).toBe(
      'https://ri-laptop-acme.beamd.run',
    );
  });

  it('handles a multi-label domain', () => {
    expect(tunnelHostPreview('https://ri.edge.example.co.uk', 'ri', 'box2')).toBe(
      'https://box2.edge.example.co.uk',
    );
  });

  it('returns null when the saved URL is some other tunnel', () => {
    expect(tunnelHostPreview('https://mac.tail-scale.ts.net', 'ri', 'ri-laptop')).toBeNull();
    expect(tunnelHostPreview('https://myapp.ngrok-free.app', 'ri', 'ri-laptop')).toBeNull();
  });

  it('does not match a name that is only a prefix of the label', () => {
    // `rivers` is a different tunnel, not `ri` plus an account.
    expect(tunnelHostPreview('https://rivers.beamd.run', 'ri', 'box2')).toBeNull();
  });

  it('returns null for unusable input', () => {
    expect(tunnelHostPreview(null, 'ri', 'box2')).toBeNull();
    expect(tunnelHostPreview('https://ri.beamd.run', 'ri', '')).toBeNull();
    expect(tunnelHostPreview('not a url', 'ri', 'box2')).toBeNull();
    expect(tunnelHostPreview('https://localhost:4224', 'ri', 'box2')).toBeNull();
  });
});
