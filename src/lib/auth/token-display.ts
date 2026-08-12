/**
 * Rendering an API token for a human, with no crypto in the import graph.
 *
 * Split out of `tokens.ts` for bundle size, not for tidiness. `tokens.ts`
 * imports `node:crypto` at module scope for hashing and generation, which is
 * correct there — but the settings UI only ever needed `tokenDisplay`, a
 * pure string formatter. Importing it from `tokens.ts` pulled the whole
 * `crypto-browserify` polyfill graph into the client bundle: one formatter
 * was costing ~457KB, and it landed in the main shell chunk that every route
 * waits on.
 *
 * The rule that keeps it fixed: anything the browser imports lives here,
 * anything needing real crypto stays in `tokens.ts`. An ESLint
 * `no-restricted-imports` rule enforces the direction for client components,
 * because the regression is completely invisible at review time — the import
 * looks identical either way.
 */

import { APP_SHORT_ID } from '@/constants/app';

/** Which key namespace a token belongs to. */
export type TokenEnv = 'live' | 'test';

/**
 * Masked form for the UI: `flow_live_V1StGX…mX3wQ`. Takes the stored prefix
 * and suffix rather than a token, so displaying a key never requires having
 * the plaintext — only the hash is persisted, and this renders from the
 * columns that sit alongside it.
 */
export function tokenDisplay(
  prefix: string,
  suffix: string,
  env: TokenEnv = 'live',
): string {
  return `${APP_SHORT_ID}_${env}_${prefix}…${suffix}`;
}
