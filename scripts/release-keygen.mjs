#!/usr/bin/env node
/** Make the release signing key, once (docs/publishing.md). The private half signs
 * releases and stays in CI's secrets and your own safe place. The public half is
 * written into every release, so changing it later means moving every installation. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

const folder = process.argv[2] ?? path.join(os.homedir(), '.config/ri-release');
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
const privateFile = path.join(folder, 'release-signing.pem');
const publicFile = path.join(folder, 'release-public.pem');
if (fs.existsSync(privateFile)) throw new Error(`${privateFile} already exists. A new key would orphan every installation that trusts the old one.`);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
fs.writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
fs.writeFileSync(publicFile, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
console.info(`Signing key: ${privateFile}\nPublic key:  ${publicFile}\n\nAdd them to the repository:\n  gh secret set RI_RELEASE_SIGNING_KEY < ${privateFile}\n  gh variable set RI_RELEASE_PUBLIC_KEY < ${publicFile}\n\nKeep a copy of the signing key somewhere safe. Losing it means no more updates for anyone who already installed Ri.`);
