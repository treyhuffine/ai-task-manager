import { z } from 'zod/v4';
import type { Ctx } from './context.js';
import { refreshPerson } from './people.js';
import { indexOpportunity, type OpportunityRow } from './pipelines.js';

/**
 * The version of the rules that write search rows. Raise it when a change to
 * those rules must correct rows already written, and `ensureSearchIndex`
 * rebuilds the affected rows once at the next start.
 *
 * 2: a company name is indexed under a person's or opportunity's source only
 *    as that source knows it. Version 1 copied the display name, which could
 *    come from a private collection.
 */
export const SEARCH_INDEX_VERSION = 2;
const KEY = 'search_index_version';

/** Rebuild search rows written under an older version of the rules, once. Returns how many records were reindexed. */
export function ensureSearchIndex(ctx: Ctx): number {
  if (ctx.settings.get(KEY, z.number().int(), 0) >= SEARCH_INDEX_VERSION) return 0;
  return ctx.db.tx(() => {
    let count = 0;
    for (const row of ctx.db.all<{ id: string }>('SELECT DISTINCT a.person_id AS id FROM affiliations a JOIN persons p ON p.id = a.person_id WHERE p.merged_into IS NULL')) {
      refreshPerson(ctx, row.id);
      count++;
    }
    for (const row of ctx.db.all<OpportunityRow>('SELECT * FROM opportunities WHERE organization_id IS NOT NULL')) {
      indexOpportunity(ctx, row);
      count++;
    }
    ctx.settings.set(KEY, SEARCH_INDEX_VERSION);
    return count;
  });
}
