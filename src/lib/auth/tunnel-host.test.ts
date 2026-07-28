import { describe, expect, it } from 'vitest';
import { tunnelHostPreview } from './tunnel-host';

describe('tunnelHostPreview', () => {
  it('swaps the name on a flat edge', () => {
    expect(tunnelHostPreview('https://flow.beamd.run', 'flow', 'flow-laptop')).toBe(
      'https://flow-laptop.beamd.run',
    );
  });

  it('keeps the account suffix on a suffixed edge', () => {
    // `flow-dev` opened on account `acme` is served at flow-dev-acme.beamd.run.
    expect(tunnelHostPreview('https://flow-dev-acme.beamd.run', 'flow-dev', 'flow-laptop')).toBe(
      'https://flow-laptop-acme.beamd.run',
    );
  });

  it('handles a multi-label domain', () => {
    expect(tunnelHostPreview('https://flow.edge.example.co.uk', 'flow', 'box2')).toBe(
      'https://box2.edge.example.co.uk',
    );
  });

  it('returns null when the saved URL is some other tunnel', () => {
    expect(tunnelHostPreview('https://mac.tail-scale.ts.net', 'flow', 'flow-laptop')).toBeNull();
    expect(tunnelHostPreview('https://myapp.ngrok-free.app', 'flow', 'flow-laptop')).toBeNull();
  });

  it('does not match a name that is only a prefix of the label', () => {
    // `flowers` is a different tunnel, not `flow` plus an account.
    expect(tunnelHostPreview('https://flowers.beamd.run', 'flow', 'box2')).toBeNull();
  });

  it('returns null for unusable input', () => {
    expect(tunnelHostPreview(null, 'flow', 'box2')).toBeNull();
    expect(tunnelHostPreview('https://flow.beamd.run', 'flow', '')).toBeNull();
    expect(tunnelHostPreview('not a url', 'flow', 'box2')).toBeNull();
    expect(tunnelHostPreview('https://localhost:4224', 'flow', 'box2')).toBeNull();
  });
});
