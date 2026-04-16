#!/usr/bin/env tsx
/**
 * `pnpm auth:pair`
 *
 * Thin wrapper around the CLI `pair` command for convenience.
 */

import { pairCommand } from '../src/cli/commands/pair';

pairCommand().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
