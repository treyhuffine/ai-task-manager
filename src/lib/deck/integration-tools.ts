import { INTEGRATION_LABELS } from '@/constants/integrations';
import type { ToolSet } from 'ai';
import { getIntegrationRuntime, getIntegrationOwnerId, getIntegrationTools } from '@/lib/integrations/runtime';

/** Action id → tool name. Mirrors the integrations' `toToolName` sanitization. */
function toToolName(actionId: string): string {
  return actionId.replace(/[^a-zA-Z0-9_-]/g, '__');
}

/**
 * Tool names of the owner's READ-ONLY integration actions on connected
 * toolkits. Filtered on the authoritative per-action `mutating` flag (not a
 * name heuristic). Empty on any error or when nothing is connected.
 *
 * Used two ways: as the key filter for `getReadOnlyIntegrationTools`, and as
 * the `mcp__integrations__<name>` allowlist when deck context gathering runs
 * through a harness with the integrations MCP attached.
 */
export async function getReadOnlyIntegrationToolNames(
  ownerId: string = getIntegrationOwnerId(),
): Promise<string[]> {
  try {
    const runtime = await getIntegrationRuntime();
    const connections = await runtime.listConnections({ ownerId });
    if (connections.length === 0) return [];
    const connectedProviders = new Set(connections.map((c) => c.providerId));

    const readOnly = new Set<string>();
    for (const tk of runtime.getToolkits()) {
      if (!connectedProviders.has(tk.providerId)) continue;
      for (const a of tk.actions) {
        if (!a.mutating) readOnly.add(toToolName(a.id));
      }
    }
    return [...readOnly];
  } catch (err) {
    console.warn(`[deck] read-only ${INTEGRATION_LABELS.singular.toLowerCase()} tool names unavailable`, err);
    return [];
  }
}

/**
 * The owner's integration tools, filtered to READ-ONLY actions (no mutations).
 *
 * The deck consults connected services while *gathering context* — it must
 * never create, send, or delete anything in that pass.
 *
 * Returns {} when nothing is connected or on any error — generation degrades to
 * "no external tools" rather than failing.
 */
export async function getReadOnlyIntegrationTools(
  ownerId: string = getIntegrationOwnerId(),
): Promise<ToolSet> {
  try {
    const readOnly = new Set(await getReadOnlyIntegrationToolNames(ownerId));
    if (readOnly.size === 0) return {};
    const all = await getIntegrationTools(ownerId);
    const filtered: ToolSet = {};
    for (const [name, t] of Object.entries(all)) {
      if (readOnly.has(name)) filtered[name] = t;
    }
    return filtered;
  } catch (err) {
    console.warn(`[deck] read-only ${INTEGRATION_LABELS.singular.toLowerCase()} tools unavailable`, err);
    return {};
  }
}
