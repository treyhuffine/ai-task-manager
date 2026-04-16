#!/usr/bin/env tsx
/**
 * `pnpm auth:pair`
 *
 * Prints the current host pairing URL. Creates one if missing.
 */

import { ensureLocalToken } from '../src/lib/auth/bootstrap';

function main() {
  const info = ensureLocalToken();
  if (info.created) {
    console.log('Created new host token.');
  }
  console.log(info.pairingUrl);
}

main();
