/**
 * The `read_web_page` capability: one public page, for an app that keeps what
 * people save. It carries no cookies or sign-ins and never reaches this
 * computer or its network. Reading is bounded in time and bytes. Failures are
 * results, because an app records why a page could not be read.
 */
import type dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { z } from 'zod/v4';
import { isPrivateHost, publicLookup } from '@/lib/oauth/clients';

export const webPageInput = z.object({ url: z.string().min(1).max(4096) }).strict();

export type WebPageOutcome = 'read' | 'not_text' | 'http_error' | 'blocked' | 'unreachable' | 'timeout' | 'too_many_redirects' | 'invalid';
export interface WebPage {
  outcome: WebPageOutcome;
  status: number | null;
  finalUrl: string | null;
  contentType: string | null;
  /** Decoded HTML or plain text, when `outcome` is `read`. */
  text: string | null;
  truncated: boolean;
}

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; RiBookmarks/0.1; personal bookmark reader)';
const READABLE = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i;

/** Test seam for the private-network floor. Production uses the real one. */
export interface WebPageNetwork {
  isBlocked(hostname: string): boolean;
  lookup: ReturnType<typeof publicLookup>;
}
const realNetwork: WebPageNetwork = { isBlocked: isPrivateHost, lookup: publicLookup() };

const failed = (outcome: WebPageOutcome, status: number | null = null, finalUrl: string | null = null, contentType: string | null = null): WebPage =>
  ({ outcome, status, finalUrl, contentType, text: null, truncated: false });

function charsetOf(contentType: string, head: Buffer): string {
  const declared = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head.subarray(0, 4096).toString('latin1'))?.[1];
  return declared?.toLowerCase() ?? 'utf-8';
}
function decode(bytes: Buffer, contentType: string): string {
  try {
    return new TextDecoder(charsetOf(contentType, bytes)).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

/** One request. Resolves with the response or an outcome, never a rejection. */
function requestOnce(url: URL, signal: AbortSignal, network: WebPageNetwork): Promise<WebPage | { redirect: string }> {
  return new Promise((resolve) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(url, {
      signal,
      lookup: network.lookup as unknown as typeof dns.lookup,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1', 'accept-encoding': 'gzip, deflate, br', 'accept-language': 'en' },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers['content-type'] ?? '');
      const finalUrl = url.href;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.destroy();
        return resolve({ redirect: response.headers.location });
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        return resolve(failed('http_error', status, finalUrl, contentType || null));
      }
      if (!READABLE.test(contentType)) {
        response.destroy();
        return resolve(failed('not_text', status, finalUrl, contentType || null));
      }
      const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
      const decoder = encoding === 'gzip' || encoding === 'x-gzip' ? zlib.createGunzip() : encoding === 'br' ? zlib.createBrotliDecompress() : encoding === 'deflate' ? zlib.createInflate() : null;
      const stream = decoder ? response.pipe(decoder) : response;
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      const finish = (truncated: boolean) => {
        if (done) return;
        done = true;
        response.destroy();
        decoder?.destroy();
        resolve({ outcome: 'read', status, finalUrl, contentType: contentType || null, text: decode(Buffer.concat(chunks), contentType), truncated });
      };
      // The size is counted after decompression, so a small compressed bomb stops here too.
      stream.on('data', (chunk: Buffer) => {
        if (done) return;
        const room = MAX_BYTES - size;
        chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
        size += Math.min(chunk.length, room);
        if (chunk.length >= room) finish(true);
      });
      stream.on('end', () => finish(false));
      const lost = () => {
        if (done) return;
        done = true;
        response.destroy();
        decoder?.destroy();
        resolve(failed(signal.aborted ? 'timeout' : 'unreachable', status, finalUrl, contentType || null));
      };
      stream.on('error', lost);
      response.on('error', lost);
      response.on('close', () => { if (!done && !response.complete) lost(); });
    });
    request.on('error', (error: NodeJS.ErrnoException) => {
      if (signal.aborted) return resolve(failed('timeout', null, url.href));
      resolve(failed(error.code === 'EPRIVATE' ? 'blocked' : 'unreachable', null, url.href));
    });
  });
}

export async function readWebPage(raw: string, parent: AbortSignal, network: WebPageNetwork = realNetwork, timeoutMs = TIMEOUT_MS): Promise<WebPage> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return failed('invalid');
  }
  const signal = AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return failed('invalid', null, url.href);
    // A literal address never reaches the lookup, so it is checked here. Every hop is checked again.
    if (network.isBlocked(url.hostname)) return failed('blocked', null, url.href);
    const result = await requestOnce(url, signal, network);
    if (!('redirect' in result)) return result;
    try {
      url = new URL(result.redirect, url);
    } catch {
      return failed('invalid', null, url.href);
    }
  }
  return failed('too_many_redirects', null, url.href);
}
