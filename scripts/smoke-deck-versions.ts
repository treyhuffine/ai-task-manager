/**
 * Query-layer smoke for the proactive deck versioning. No AI — exercises
 * supersede / active / versions / revert directly. Run against a throwaway DB:
 *   FLOW_DB_PATH=/tmp/deck-smoke.db pnpm tsx scripts/smoke-deck-versions.ts
 */
import {
  supersedeAndInsertDeck,
  getActiveDeckForDate,
  getDeckVersions,
  revertDeckTo,
  type SupersedeDeckInput,
} from '../src/lib/db/queries';
import { getDb } from '../src/lib/db';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`);
  if (!cond) failures++;
}

function mkDeck(forDate: string, origin: SupersedeDeckInput['origin'], taskIds: string[]): SupersedeDeckInput {
  return {
    forDate,
    origin,
    framing: null,
    context: null,
    contextTags: [],
    searchContext: null,
    model: 'smoke',
    items: taskIds.map((id) => ({ taskId: id, rationale: 'r', continuityContext: null, source: 'ai' as const })),
    alternatives: [],
    changes: [],
  };
}

getDb(); // apply migrations

const TODAY = '2026-06-18';
const YESTERDAY = '2026-06-17';

// Seed yesterday so we can prove day isolation.
const y1 = supersedeAndInsertDeck(mkDeck(YESTERDAY, 'first_open', ['x', 'y']));

// v1 → v2 for today.
const v1 = supersedeAndInsertDeck(mkDeck(TODAY, 'first_open', ['a', 'b', 'c']));
const v2 = supersedeAndInsertDeck(mkDeck(TODAY, 'manual', ['a', 'b', 'd']));

check('v2 is the active deck for today', getActiveDeckForDate(TODAY)?.id === v2.id);
check('v2.replacesDeckId chains to v1', v2.replacesDeckId === v1.id);
check('v1 got superseded', getDeckVersions(TODAY).find((d) => d.id === v1.id)?.supersededAt != null);
check('today has exactly 2 versions', getDeckVersions(TODAY).length === 2);
check('exactly one active version for today', getDeckVersions(TODAY).filter((d) => d.supersededAt == null).length === 1);
check('yesterday is unaffected (still active)', getActiveDeckForDate(YESTERDAY)?.id === y1.id);

// Revert to v1 — the escape hatch.
const reverted = revertDeckTo(v1.id);
check('revert returns v1', reverted?.id === v1.id);
check('v1 is active again after revert', getActiveDeckForDate(TODAY)?.id === v1.id);
check('v2 superseded after revert', getDeckVersions(TODAY).find((d) => d.id === v2.id)?.supersededAt != null);
check('still exactly one active after revert', getDeckVersions(TODAY).filter((d) => d.supersededAt == null).length === 1);

// Regen after revert supersedes the now-active v1.
const v3 = supersedeAndInsertDeck(mkDeck(TODAY, 'manual', ['a', 'e']));
check('v3 is active after regen', getActiveDeckForDate(TODAY)?.id === v3.id);
check('v3.replacesDeckId chains to v1 (the active one)', v3.replacesDeckId === v1.id);
check('today now has 3 versions (full history kept)', getDeckVersions(TODAY).length === 3);
check('still exactly one active', getDeckVersions(TODAY).filter((d) => d.supersededAt == null).length === 1);

// Revert idempotency: reverting to the already-active deck is a no-op-ish.
const again = revertDeckTo(v3.id);
check('reverting to active deck keeps it active', again?.id === v3.id && getActiveDeckForDate(TODAY)?.id === v3.id);

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURE(S) ✗`);
process.exit(failures === 0 ? 0 : 1);
