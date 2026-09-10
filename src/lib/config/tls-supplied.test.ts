import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as x509 from '@peculiar/x509';
import { loadSuppliedTls } from './tls';
import { certCoversHost } from './http2';

const ALG: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};

let tmp: string;

beforeAll(() => {
  x509.cryptoProvider.set(globalThis.crypto as Crypto);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-supcert-'));
});

/** Mint a self-signed cert with explicit validity + SAN host, write cert+key to disk. */
async function mintCert(
  label: string,
  notBefore: Date,
  notAfter: Date,
  sanHost = 'localhost',
): Promise<{ certPath: string; keyPath: string; certPem: string }> {
  const crypto = globalThis.crypto as Crypto;
  const keys = (await crypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const cert = await x509.X509CertificateGenerator.createSelfSigned(
    {
      serialNumber: '01',
      name: `CN=${sanHost}`,
      notBefore,
      notAfter,
      keys,
      signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      extensions: [
        new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: sanHost }], false),
      ],
    },
    crypto,
  );
  const certPath = path.join(tmp, `${label}.crt`);
  const keyPath = path.join(tmp, `${label}.key`);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keys.privateKey);
  const certPem = cert.toString('pem');
  fs.writeFileSync(certPath, certPem);
  fs.writeFileSync(keyPath, x509.PemConverter.encode(pkcs8, 'PRIVATE KEY'));
  return { certPath, keyPath, certPem };
}

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;

describe('loadSuppliedTls validity', () => {
  it('rejects an expired certificate', async () => {
    const { certPath, keyPath } = await mintCert('expired', new Date(Date.now() - 2 * YEAR), new Date(Date.now() - YEAR));
    await expect(loadSuppliedTls(certPath, keyPath)).rejects.toThrow(/expired/i);
  });

  it('rejects a not-yet-valid certificate', async () => {
    const { certPath, keyPath } = await mintCert('future', new Date(Date.now() + YEAR), new Date(Date.now() + 2 * YEAR));
    await expect(loadSuppliedTls(certPath, keyPath)).rejects.toThrow(/not valid until/i);
  });

  it('accepts a currently-valid supplied pair', async () => {
    const { certPath, keyPath } = await mintCert('valid', new Date(Date.now() - DAY), new Date(Date.now() + YEAR));
    const material = await loadSuppliedTls(certPath, keyPath);
    expect(material.source).toBe('supplied');
    expect(material.probeCa).toContain('BEGIN CERTIFICATE');
  });

  it('rejects a mismatched cert/key pair', async () => {
    const a = await mintCert('a', new Date(Date.now() - DAY), new Date(Date.now() + YEAR));
    const b = await mintCert('b', new Date(Date.now() - DAY), new Date(Date.now() + YEAR));
    await expect(loadSuppliedTls(a.certPath, b.keyPath)).rejects.toThrow(/do not match/i);
  });
});

describe('certCoversHost (independent hostname validation)', () => {
  it('accepts a cert covering the host and rejects a wrong-host cert', async () => {
    const ok = await mintCert('host-ok', new Date(Date.now() - DAY), new Date(Date.now() + YEAR), 'localhost');
    const wrong = await mintCert('host-wrong', new Date(Date.now() - DAY), new Date(Date.now() + YEAR), 'wrong.example');
    expect(certCoversHost(ok.certPem, 'localhost')).toBe(true);
    // The core of the fix: a cert for another host must NOT be accepted for localhost,
    // even though the probe's TLS error could otherwise be masked as a chain issue.
    expect(certCoversHost(wrong.certPem, 'localhost')).toBe(false);
    expect(certCoversHost('not a cert', 'localhost')).toBe(false);
  });
});
