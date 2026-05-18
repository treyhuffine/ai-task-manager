import { describe, it, expect } from 'vitest';
import { createBaseTagInjector } from './inject-base';

const enc = new TextEncoder();
const dec = new TextDecoder();

async function pipe(input: string | string[], baseHref = '/preview/ws_abc/'): Promise<string> {
  const inputs = Array.isArray(input) ? input : [input];
  const transform = createBaseTagInjector(baseHref);
  const writable = transform.writable.getWriter();
  const reader = transform.readable.getReader();

  const writePromise = (async () => {
    for (const chunk of inputs) await writable.write(enc.encode(chunk));
    await writable.close();
  })();

  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  out += dec.decode();
  await writePromise;
  return out;
}

describe('createBaseTagInjector', () => {
  it('inserts after <head> when present', async () => {
    const html = '<!doctype html><html><head><title>x</title></head><body>hi</body></html>';
    const out = await pipe(html);
    expect(out).toBe(
      '<!doctype html><html><head><base href="/preview/ws_abc/"><title>x</title></head><body>hi</body></html>',
    );
  });

  it('inserts after <html> when no <head>', async () => {
    const html = '<!doctype html><html><body>hi</body></html>';
    const out = await pipe(html);
    expect(out).toContain('<html><base href="/preview/ws_abc/"><body>');
  });

  it('inserts after <!doctype> when no <html>', async () => {
    const html = '<!doctype html>Naked body text';
    const out = await pipe(html);
    expect(out).toBe('<!doctype html><base href="/preview/ws_abc/">Naked body text');
  });

  it('preserves attribute-laden <html> open tags', async () => {
    const html = '<!doctype html><html lang="en" data-x="y"><head></head></html>';
    const out = await pipe(html);
    expect(out).toContain('<html lang="en" data-x="y"><head><base href="/preview/ws_abc/"></head>');
  });

  it('handles <HEAD> uppercase', async () => {
    const html = '<!DOCTYPE html><HTML><HEAD></HEAD></HTML>';
    const out = await pipe(html);
    expect(out).toBe('<!DOCTYPE html><HTML><HEAD><base href="/preview/ws_abc/"></HEAD></HTML>');
  });

  it('handles chunks split mid-tag', async () => {
    const out = await pipe(['<!doctype html><ht', 'ml><he', 'ad>', '<title>t</title></head></html>']);
    expect(out).toContain('<head><base href="/preview/ws_abc/"><title>');
  });

  it('escapes quotes in the base href', async () => {
    const out = await pipe('<head></head>', '/p/ws"x/');
    expect(out).toContain('<base href="/p/ws&quot;x/">');
  });

  it('only injects once even with multiple chunks after', async () => {
    const out = await pipe(['<head></head>', '<head></head>']);
    expect(out.match(/<base /g)?.length ?? 0).toBe(1);
  });

  it('passes through unchanged when no injection point found in budget', async () => {
    const body = 'just text, no html at all';
    const out = await pipe(body);
    expect(out).toBe(body);
  });

  it('streams large bodies after injection without buffering', async () => {
    const tail = 'x'.repeat(200_000);
    const out = await pipe(['<head>', tail, '</head>']);
    expect(out.length).toBe('<head><base href="/preview/ws_abc/">'.length + tail.length + '</head>'.length);
    expect(out.startsWith('<head><base href="/preview/ws_abc/">')).toBe(true);
    expect(out.endsWith(tail + '</head>')).toBe(true);
  });
});
