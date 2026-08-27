/**
 * Repair CLI for the entity-links backlink index (docs/entity-links-spec.md §10).
 *
 * Reconciles every task/note's edges from its current body, marks all
 * projections caught up, and prunes orphaned source rows. Idempotent and safe
 * to run any time. The index is normally self-healing (one-shot backfill on
 * upgrade + transactional read-repair), so this is an operator escape hatch.
 *
 *   pnpm db:relink            # prod data root
 *   FLOW_ROOT=~/flow-dev pnpm db:relink
 */
import { rebuildAllEntityLinks } from '../src/lib/db/queries';

const result = rebuildAllEntityLinks();
console.log(
  `[entity-links] reconciled ${result.sources} source${result.sources === 1 ? '' : 's'}, ` +
    `pruned ${result.pruned} orphan edge${result.pruned === 1 ? '' : 's'}.`,
);
