/**
 * X.509 CA/leaf generation, isolated behind DYNAMIC imports.
 *
 * `reflect-metadata` and `@peculiar/x509` are loaded with `await import(...)`,
 * never as static/bare imports. esbuild hoists bare side-effect imports
 * (`import 'reflect-metadata'`) to eager execution even from a module that is
 * only ever dynamically imported — which would initialize them on the default
 * (HTTP, no `--http2`) CLI path. Dynamic import guarantees they run only when
 * certificate generation actually happens. This module is itself reached only
 * via `await import('./tls-x509')` from tls.ts.
 */

import crypto from 'node:crypto';

export interface GeneratedPair {
  certPem: string;
  keyPem: string;
}

export interface SanEntry {
  type: 'dns' | 'ip';
  value: string;
}

const KEY_GEN_ALG: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};
const SIGNING_ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

type X509Module = typeof import('@peculiar/x509');
let cached: X509Module | null = null;

/** Load @peculiar/x509 (and its reflect-metadata dependency) on first use. */
async function loadX509(): Promise<X509Module> {
  if (!cached) {
    await import('reflect-metadata');
    const mod = await import('@peculiar/x509');
    mod.cryptoProvider.set(globalThis.crypto as Crypto);
    cached = mod;
  }
  return cached;
}

/** 16 random bytes as a positive hex serial (high bit cleared). */
function randomSerialHex(): string {
  const bytes = crypto.randomBytes(16);
  bytes[0] &= 0x7f;
  return bytes.toString('hex');
}

async function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  const c = globalThis.crypto as Crypto;
  return (await c.subtle.generateKey(KEY_GEN_ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
}

async function privateKeyPem(mod: X509Module, pair: CryptoKeyPair): Promise<string> {
  const pkcs8 = await (globalThis.crypto as Crypto).subtle.exportKey('pkcs8', pair.privateKey);
  return mod.PemConverter.encode(pkcs8, 'PRIVATE KEY');
}

/** Generate a self-signed CA: cA=true, pathLen=0, keyCertSign, backdated start. */
export async function generateCaPair(opts: { years: number; clockSkewMs: number }): Promise<GeneratedPair> {
  const mod = await loadX509();
  const c = globalThis.crypto as Crypto;
  const keys = await generateRsaKeyPair();
  const now = Date.now();
  const notBefore = new Date(now - opts.clockSkewMs);
  const notAfter = new Date(now);
  notAfter.setFullYear(notAfter.getFullYear() + opts.years);

  const cert = await mod.X509CertificateGenerator.createSelfSigned(
    {
      serialNumber: randomSerialHex(),
      name: 'CN=Ri Local CA,O=Ri',
      notBefore,
      notAfter,
      keys,
      signingAlgorithm: SIGNING_ALG,
      extensions: [
        new mod.BasicConstraintsExtension(true, 0, true),
        new mod.KeyUsagesExtension(mod.KeyUsageFlags.keyCertSign | mod.KeyUsageFlags.cRLSign, true),
        await mod.SubjectKeyIdentifierExtension.create(keys.publicKey, false, c),
      ],
    },
    c,
  );
  return { certPem: cert.toString('pem'), keyPem: await privateKeyPem(mod, keys) };
}

/** Generate a leaf signed by the CA: non-CA, serverAuth, SANs, never outliving the CA. */
export async function generateLeafPair(opts: {
  caCertPem: string;
  caKeyPem: string;
  sans: SanEntry[];
  days: number;
  clockSkewMs: number;
}): Promise<GeneratedPair> {
  const mod = await loadX509();
  const c = globalThis.crypto as Crypto;
  const caCert = new mod.X509Certificate(opts.caCertPem);
  const caPrivate = await c.subtle.importKey(
    'pkcs8',
    mod.PemConverter.decodeFirst(opts.caKeyPem),
    KEY_GEN_ALG,
    false,
    ['sign'],
  );

  const leafKeys = await generateRsaKeyPair();
  const now = Date.now();
  const notBefore = new Date(now - opts.clockSkewMs);
  let notAfter = new Date(now + opts.days * 24 * 60 * 60 * 1000);
  if (notAfter > caCert.notAfter) notAfter = caCert.notAfter;

  const cert = await mod.X509CertificateGenerator.create(
    {
      serialNumber: randomSerialHex(),
      subject: 'CN=localhost',
      issuer: caCert.subject,
      notBefore,
      notAfter,
      publicKey: leafKeys.publicKey,
      signingKey: caPrivate,
      signingAlgorithm: SIGNING_ALG,
      extensions: [
        new mod.BasicConstraintsExtension(false, undefined, true),
        new mod.KeyUsagesExtension(
          mod.KeyUsageFlags.digitalSignature | mod.KeyUsageFlags.keyEncipherment,
          true,
        ),
        new mod.ExtendedKeyUsageExtension([mod.ExtendedKeyUsage.serverAuth], false),
        new mod.SubjectAlternativeNameExtension(opts.sans, false),
        await mod.SubjectKeyIdentifierExtension.create(leafKeys.publicKey, false, c),
        await mod.AuthorityKeyIdentifierExtension.create(caCert, false, c),
      ],
    },
    c,
  );
  return { certPem: cert.toString('pem'), keyPem: await privateKeyPem(mod, leafKeys) };
}
