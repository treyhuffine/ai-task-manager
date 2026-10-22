import type { EffortLevel } from '@/db/types';
import { setDefaultSelection, type DefaultSelection } from '@/lib/client/default-selection';
import type { HarnessId } from '@/lib/harness/registry';

/**
 * Make a harness the one Ri runs on, from first-run setup: its default model
 * (the one picked, else the harness's own) and effort (the one picked, else
 * the harness's usual) made the home's default the same way the model menus'
 * "Make default" does (`setDefaultSelection`). Returns the tuple it saved, so
 * the caller can start the main chat over on it when it changed. Ri's skills
 * aren't tied to the harness: they went in for every harness as the
 * conversation opened (`agent-skill-install.ts`).
 */
export async function saveHarnessSetup(input: {
  harness: HarnessId;
  model?: string;
  variant?: string | null;
  effort?: EffortLevel | null;
  serviceTier?: string | null;
}): Promise<DefaultSelection> {
  return setDefaultSelection(input);
}
