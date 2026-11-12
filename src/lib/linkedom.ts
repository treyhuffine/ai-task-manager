/**
 * How server code loads linkedom: with require(), never import.
 *
 * linkedom ships an ESM build and a CommonJS build, and the CommonJS build
 * require()s css-select, which is ESM-only. When an import() of the ESM build is
 * still loading css-select and a require() of the CommonJS build reaches it,
 * Node throws ERR_REQUIRE_ESM_RACE_CONDITION. Next loads routes side by side,
 * both when it collects page data for a build and when requests first reach
 * them, so mixing the two formats fails at random.
 *
 * Turbopack compiles this createRequire call to an external require(), so the
 * server has one copy of linkedom, in one format.
 * `linkedom.test.ts` fails on an import of linkedom anywhere else in server code.
 */
import { createRequire } from 'node:module';

type Linkedom = typeof import('linkedom');

const nodeRequire = createRequire(import.meta.url);

/** linkedom's parseHTML, loaded on first use. */
export const parseHTML: Linkedom['parseHTML'] = (html, globals) =>
  (nodeRequire('linkedom') as Linkedom).parseHTML(html, globals);
