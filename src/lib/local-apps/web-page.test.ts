/**
 * `read_web_page` against real sockets. The permissive network stands in for the
 * public internet so a local server can answer. The floor tests use the real one.
 */
import http from 'node:http';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publicLookup } from '@/lib/oauth/clients';
import { readWebPage, webPageInput, type WebPageNetwork } from './web-page';
import dns from 'node:dns';

let server: http.Server;
let base: string;
let seenHeaders: http.IncomingHttpHeaders | null = null;
const never = new AbortController().signal;
const open: WebPageNetwork = { isBlocked: () => false, lookup: dns.lookup as unknown as WebPageNetwork['lookup'] };
const MIB = 1024 * 1024;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    seenHeaders = request.headers;
    const url = new URL(request.url!, 'http://local');
    const html = (body: string, headers: http.OutgoingHttpHeaders = {}) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers }); response.end(body); };
    switch (url.pathname) {
      case '/page': return html('<title>Hello</title><p>World</p>');
      case '/plain': response.writeHead(200, { 'content-type': 'text/plain' }); return response.end('Plain words');
      case '/gzip': return html(zlib.gzipSync('<p>Squeezed</p>') as unknown as string, { 'content-encoding': 'gzip' });
      case '/brotli': return html(zlib.brotliCompressSync('<p>Brotli</p>') as unknown as string, { 'content-encoding': 'br' });
      case '/latin1': response.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' }); return response.end(Buffer.from('<p>caf\xe9</p>', 'latin1'));
      case '/meta-charset': response.writeHead(200, { 'content-type': 'text/html' }); return response.end(Buffer.from('<meta charset="iso-8859-1"><p>caf\xe9</p>', 'latin1'));
      case '/huge': response.writeHead(200, { 'content-type': 'text/html' }); return response.end(Buffer.alloc(4 * MIB, 97));
      case '/bomb': return html(zlib.gzipSync(Buffer.alloc(40 * MIB, 97)) as unknown as string, { 'content-encoding': 'gzip' });
      case '/pdf': response.writeHead(200, { 'content-type': 'application/pdf' }); return response.end('%PDF');
      case '/none': response.writeHead(200); return response.end('no type');
      case '/gone': response.writeHead(404, { 'content-type': 'text/html' }); return response.end('gone');
      case '/login': response.writeHead(403, { 'content-type': 'text/html' }); return response.end('no');
      case '/redirect': response.writeHead(302, { location: '/page' }); return response.end();
      case '/loop': response.writeHead(302, { location: '/loop' }); return response.end();
      case '/to-private': response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return response.end();
      case '/to-file': response.writeHead(302, { location: 'file:///etc/passwd' }); return response.end();
      case '/slow': return void setTimeout(() => html('late'), 5000);
      case '/cut': response.writeHead(200, { 'content-type': 'text/html', 'content-length': '1000' }); response.write('partial'); return void setTimeout(() => response.destroy(), 20);
      default: response.writeHead(500); return response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

const read = (path: string, timeoutMs?: number) => readWebPage(`${base}${path}`, never, open, timeoutMs);

describe('reading', () => {
  it('returns a page and carries nothing of the person', async () => {
    expect(await read('/page')).toMatchObject({ outcome: 'read', status: 200, text: '<title>Hello</title><p>World</p>', truncated: false, contentType: 'text/html; charset=utf-8' });
    expect(seenHeaders?.cookie).toBeUndefined();
    expect(seenHeaders?.authorization).toBeUndefined();
    expect(seenHeaders?.['user-agent']).toContain('RiBookmarks');
    expect(await read('/plain')).toMatchObject({ outcome: 'read', text: 'Plain words' });
  });
  it('decompresses and decodes', async () => {
    expect((await read('/gzip')).text).toBe('<p>Squeezed</p>');
    expect((await read('/brotli')).text).toBe('<p>Brotli</p>');
    expect((await read('/latin1')).text).toBe('<p>café</p>');
    expect((await read('/meta-charset')).text).toContain('café');
  });
  it('stops at the limit, counting after decompression', async () => {
    for (const path of ['/huge', '/bomb']) {
      const page = await read(path);
      expect(page, path).toMatchObject({ outcome: 'read', truncated: true });
      expect(page.text!.length, path).toBe(3 * MIB);
    }
  });
  it('follows redirects to a limit, and reports the final address', async () => {
    expect(await read('/redirect')).toMatchObject({ outcome: 'read', finalUrl: `${base}/page` });
    expect((await read('/loop')).outcome).toBe('too_many_redirects');
  });
  it('turns every failure into a result', async () => {
    expect(await read('/pdf')).toMatchObject({ outcome: 'not_text', contentType: 'application/pdf', text: null });
    expect((await read('/none')).outcome).toBe('not_text');
    expect(await read('/gone')).toMatchObject({ outcome: 'http_error', status: 404 });
    expect(await read('/login')).toMatchObject({ outcome: 'http_error', status: 403 });
    expect((await read('/cut')).outcome).toBe('unreachable');
    expect((await read('/slow', 100)).outcome).toBe('timeout');
    expect((await readWebPage('http://127.0.0.1:1/', never, open)).outcome).toBe('unreachable');
    const aborted = new AbortController();
    aborted.abort();
    expect((await readWebPage(`${base}/page`, aborted.signal, open)).outcome).toBe('timeout');
  });
  it('reads only plain web addresses', async () => {
    for (const bad of ['not a url', 'file:///etc/passwd', 'ftp://example.test/', 'javascript:alert(1)', 'https://user:pass@example.test/']) expect((await readWebPage(bad, never, open)).outcome, bad).toBe('invalid');
    expect((await read('/to-file')).outcome).toBe('invalid');
    expect(() => webPageInput.parse({ url: 'x', extra: 1 })).toThrow();
  });
});

describe('the private-network floor', () => {
  it('refuses this computer and its network by address and by name', async () => {
    for (const url of [
      `${base}/page`, 'http://localhost/', 'http://foo.localhost/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://0.0.0.0/',
      'http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://printer.local/', 'http://metadata.google.internal/', 'http://router/',
    ]) expect((await readWebPage(url, never)).outcome, url).toBe('blocked');
  });
  it('checks every redirect', async () => {
    const network: WebPageNetwork = { ...open, isBlocked: host => host !== '127.0.0.1' };
    expect((await readWebPage(`${base}/to-private`, never, network)).outcome).toBe('blocked');
  });
  it('refuses a public name that resolves to a private address, where the socket connects', async () => {
    const rebinding = publicLookup(((_host: string, _options: dns.LookupOptions, callback: (error: null, address: string, family: number) => void) => callback(null, '127.0.0.1', 4)) as never);
    const network: WebPageNetwork = { isBlocked: () => false, lookup: rebinding };
    const port = new URL(base).port;
    const page = await readWebPage(`http://public.example:${port}/page`, never, network);
    expect(page.outcome).toBe('blocked');
    expect(page.text).toBeNull();
  });
});
