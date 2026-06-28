import type { ToolSet } from 'ai';
import { getConnectorRuntime, getConnectorOwnerId, getConnectorTools } from '@/lib/connectors/runtime';

/** Action id → tool name. Mirrors the connectors' `toToolName` sanitization. */
function toToolName(actionId: string): string {
  return actionId.replace(/[^a-zA-Z0-9_-]/g, '__');
}

/**
 * The owner's connector tools, filtered to READ-ONLY actions (no mutations).
 *
 * The deck consults connected services while *gathering context* — it must
 * never create, send, or delete anything in that pass. We filter on the
 * authoritative per-action `mutating` flag (not a name heuristic): build the
 * set of non-mutating action tool-names on connected toolkits, then keep only
 * those keys from the full ToolSet.
 *
 * Returns {} when nothing is connected or on any error — generation degrades to
 * "no external tools" rather than failing.
 */
export async function getReadOnlyConnectorTools(
  ownerId: string = getConnectorOwnerId(),
): Promise<ToolSet> {
  try {
    const runtime = await getConnectorRuntime();
    const connections = await runtime.listConnections({ ownerId });
    if (connections.length === 0) return {};
    const connectedProviders = new Set(connections.map((c) => c.providerId));

    const readOnly = new Set<string>();
    for (const tk of runtime.getToolkits()) {
      if (!connectedProviders.has(tk.providerId)) continue;
      for (const a of tk.actions) {
        if (!a.mutating) readOnly.add(toToolName(a.id));
      }
    }

    const all = await getConnectorTools(ownerId);
    const filtered: ToolSet = {};
    for (const [name, t] of Object.entries(all)) {
      if (readOnly.has(name)) filtered[name] = t;
    }
    return filtered;
  } catch (err) {
    console.warn('[deck] read-only connector tools unavailable', err);
    return {};
  }
}
