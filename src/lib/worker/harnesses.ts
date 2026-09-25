/**
 * What this computer can run: each enabled harness as its runtime sees it
 * here (installed, version, capabilities). The home stores the report from
 * each heartbeat, and later builds session specs for this computer from it.
 */

import type { WorkerHarnessReport } from '@/db/types';
import { HARNESS_REGISTRY, isHarnessEnabled, type HarnessId } from '@/lib/harness/registry';
import { getHarnessRuntime } from '@/lib/harness/runtime';

export async function describeHarnesses(options: { refresh?: boolean } = {}): Promise<WorkerHarnessReport[]> {
  const ids = (Object.keys(HARNESS_REGISTRY) as HarnessId[]).filter((id) => isHarnessEnabled(id));
  return Promise.all(
    ids.map(async (harness): Promise<WorkerHarnessReport> => {
      try {
        const runtime = await getHarnessRuntime(harness, { refresh: options.refresh });
        return { harness, binary: { ...runtime.binary }, capabilities: { ...runtime.capabilities } };
      } catch (err) {
        return {
          harness,
          binary: { status: 'error', error: err instanceof Error ? err.message : String(err) },
          capabilities: {},
        };
      }
    }),
  );
}
