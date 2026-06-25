/**
 * AWS Signature Version 4 request signer. Like oauth1, there is no stored token —
 * each request is signed: build the canonical request, derive a date/region/service
 * signing key, HMAC the string-to-sign, and write the `Authorization` header (plus
 * `x-amz-date` and, when present, `x-amz-security-token`).
 *
 * Single path-encoding is used (correct for S3 and typical REST paths); the rare
 * non-S3 double-encoding nuance is not applied. Payload is hashed inline.
 */
import { createHash, createHmac } from 'node:crypto';
import type { AuthApplyContext, AuthStrategy, Credentials } from '../core/types';

export interface AwsSigV4Config {
  /** Default region/service if the credential doesn't carry them. */
  region?: string;
  service?: string;
  /** Test hook — deterministic signing time. Defaults to wall clock. */
  timestamp?: () => Date;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}
function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}
/** RFC 3986 encoding for query keys/values (AWS encodes everything except unreserved). */
function enc(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function amzDate(d: Date): { amzdate: string; datestamp: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20150830T123600Z
  return { amzdate: iso, datestamp: iso.slice(0, 8) };
}

export function awsSigV4(config: AwsSigV4Config = {}): AuthStrategy {
  const nowFn = config.timestamp ?? (() => new Date());

  return {
    kind: 'aws_sigv4',
    applyAuth(creds: Credentials, req: AuthApplyContext): void {
      if (creds.type !== 'aws_sigv4') throw new Error('aws_sigv4 strategy received wrong credentials');
      const region = creds.region ?? config.region;
      const service = creds.service ?? config.service;
      if (!region || !service) throw new Error('aws_sigv4 requires region + service (on the credential or config)');

      const { amzdate, datestamp } = amzDate(nowFn());
      const u = new URL(req.url);
      const payloadHash = sha256Hex(req.body ?? '');

      // Headers we sign: host + x-amz-date (+ content-type when present). x-amz-date is set here.
      req.headers['x-amz-date'] = amzdate;
      if (creds.sessionToken) req.headers['x-amz-security-token'] = creds.sessionToken;
      const signed: Record<string, string> = {
        host: u.host,
        'x-amz-date': amzdate,
      };
      const ct = req.headers['Content-Type'] ?? req.headers['content-type'];
      if (ct) signed['content-type'] = ct;

      const signedHeaderNames = Object.keys(signed).sort();
      const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${signed[h]?.trim()}\n`).join('');
      const signedHeaders = signedHeaderNames.join(';');

      // Canonical query string (sorted by key then value).
      const qs: Array<[string, string]> = [];
      u.searchParams.forEach((v, k) => qs.push([k, v]));
      const canonicalQuery = qs
        .map(([k, v]) => [enc(k), enc(v)] as [string, string])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');

      const canonicalPath = u.pathname
        .split('/')
        .map((seg) => enc(seg))
        .join('/') || '/';

      const canonicalRequest = [
        req.method.toUpperCase(),
        canonicalPath,
        canonicalQuery,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
      ].join('\n');

      const scope = `${datestamp}/${region}/${service}/aws4_request`;
      const stringToSign = ['AWS4-HMAC-SHA256', amzdate, scope, sha256Hex(canonicalRequest)].join('\n');

      const kDate = hmac(`AWS4${creds.secretAccessKey}`, datestamp);
      const kRegion = hmac(kDate, region);
      const kService = hmac(kRegion, service);
      const kSigning = hmac(kService, 'aws4_request');
      const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

      req.headers.Authorization =
        `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`;
    },
    tokenOf(): string {
      throw new Error('aws_sigv4 signs each request; there is no static token (use ctx.http)');
    },
  };
}
