import { EFFORT_LEVELS } from '@/db/types';
import { getAppRoot } from '@/lib/config/paths';
import { setHomeDefaultSelection } from '@/lib/db/queries';
import { resolveHarnessSelection } from '@/lib/harness/model-discovery';
import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Set the home's default for new work: the harness, model, variant and effort
 * new chats, executions and background calls start on (docs/default-selection.md).
 * The one way it changes from the app: Settings' "Default for new work", a
 * model menu's "Make default" and first-run setup all come here. A harness's
 * own default (`PUT /harness/models/enabled`) is a separate setting.
 *
 * The pick must be one the harness offers now. Nothing is repaired or
 * swapped: a model, variant or effort it can't run is refused, saying which.
 */
export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  const { harness, model, variant = null, effort = null } = rpcInput.body;
  let selection;
  try {
    selection = await resolveHarnessSelection(harness, { model, variant, effort }, { cwd: getAppRoot() });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  if (effort && selection.effort !== effort) {
    return reply({ error: `${model} doesn't offer ${effort} effort` }, { status: 400 });
  }
  const saved = {
    harness: selection.providerId,
    model: selection.model,
    variant: selection.variant,
    effort: selection.effort,
  };
  setHomeDefaultSelection(saved);
  return reply(saved);
}

export const PUTInput = rpcZ.object({
  body: rpcZ.object({
    harness: rpcZ.enum(KNOWN_HARNESS_IDS),
    model: rpcZ.string().trim().min(1),
    variant: rpcZ.string().trim().min(1).nullable().optional(),
    effort: rpcZ.enum(EFFORT_LEVELS).nullable().optional(),
  }).strict(),
}).strict();
