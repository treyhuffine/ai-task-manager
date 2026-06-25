/**
 * ingestMcpServer (§12): the long-tail breadth strategy. An external MCP server is
 * registered as a **dynamic provider** whose tools become actions that proxy to it —
 * and those actions flow through the EXACT SAME `runAction` pipeline, so they get the
 * same approval gate, audit, and redaction as native connectors. They can't bypass
 * safety.
 *
 * Two safety properties this enforces (§12):
 *   - **Namespacing & provenance:** action ids are `mcp.<server>.<tool>`; every result
 *     is tagged with its origin server. No collision with / impersonation of native
 *     connectors.
 *   - **Default-conservative:** ingested tools are `mutating: true, risk: 'high'` until a
 *     host says otherwise → they hit the approval gate by default.
 *
 * Note (honest, per §12): secret-confinement on ingested output is real (the runtime
 * redacts our own bytes from audit). Prompt-injection is NOT solved by scanning — the
 * defense is structural: the approval gate sits in front of every side effect. We make
 * no injection-scanning claim.
 */
import { action, defineProvider, defineToolkit } from '../core/authoring';
import { jsonSchemaToZodObject } from './json-schema';
import { bearer } from '../auth/direct';
import { newId } from '../core/ids';
import type { Registry } from '../core/registry';
import type { Connection, ConnectionStore, RiskLevel, SecretBox } from '../core/types';

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** The minimal MCP client surface ingestion needs (a test double or a real client). */
export interface McpClientLike {
  listTools(): Promise<{ tools: McpToolDef[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{ content: unknown; isError?: boolean }>;
}

export interface IngestMcpOptions {
  /** Short server name used for namespacing (`mcp.<name>.<tool>`). */
  name: string;
  client: McpClientLike;
  ownerId?: string;
  /** Default risk for every ingested tool until reclassified (default `'high'`). */
  defaultRisk?: RiskLevel;
  /** Default mutating flag (default `true` → approval-gated). */
  defaultMutating?: boolean;
  /**
   * Opaque session/bearer the connection carries. Pass the server's REAL auth
   * secret here (not a placeholder): it is sealed as the connection credential and
   * `runAction` auto-registers it with the redactor, so it is scrubbed from audit
   * and results. Vestigial only for a genuinely no-auth server.
   */
  sessionToken?: string;
  /**
   * Stable connection id. Pass a deterministic id (e.g. derived from the server
   * slug) so re-ingesting the same server overwrites one row instead of creating a
   * duplicate each boot — the ConnectionStore upserts by `connection.id`. Defaults
   * to a fresh id.
   */
  connectionId?: string;
  /**
   * Per-tool reclassification (§12). Keyed by the remote tool name:
   *   - `enabled: false` → the tool is NOT ingested (hidden from the agent).
   *   - `mutating: false` → the tool reads-through the approval gate (for a trusted read tool).
   * Tools absent from the map keep the defaults (`defaultMutating`/`defaultRisk`).
   */
  toolOverrides?: Record<string, { enabled?: boolean; mutating?: boolean }>;
}

export interface IngestMcpResult {
  providerId: string;
  toolkitId: string;
  connectionId: string;
  /** Number of tools actually ingested (after `enabled:false` overrides). */
  toolCount: number;
  /** Every tool the server advertised (incl. disabled), for the host to persist + render toggles. */
  tools: { name: string; description?: string }[];
}

export async function ingestMcpServer(
  registry: Registry,
  store: ConnectionStore,
  secretBox: SecretBox,
  opts: IngestMcpOptions,
): Promise<IngestMcpResult> {
  const safe = opts.name.replace(/[^a-zA-Z0-9_]/g, '_');
  const providerId = `mcp_${safe}`;
  const risk: RiskLevel = opts.defaultRisk ?? 'high';
  const mutating = opts.defaultMutating ?? true;

  const { tools } = await opts.client.listTools();
  const overrides = opts.toolOverrides ?? {};

  const actions = tools
    .filter((t) => overrides[t.name]?.enabled !== false) // a disabled tool is not ingested
    .map((t) => {
      const toolMutating = overrides[t.name]?.mutating ?? mutating;
      return action({
        id: `mcp.${safe}.${t.name}`,
        description: t.description
          ? `${t.description} (via MCP server "${opts.name}")`
          : `External MCP tool "${t.name}" from "${opts.name}".`,
        // Preserve the tool's real input schema (converted JSON Schema → Zod) so the model gets
        // typed args; an absent/exotic schema falls back to a permissive passthrough object. The
        // remote server is still the authoritative validator.
        input: jsonSchemaToZodObject(t.inputSchema),
        mutating: toolMutating,
        risk: toolMutating ? risk : 'low', // a tool the user trusts (non-mutating) reads through the gate
        async execute(_ctx, input) {
          const res = await opts.client.callTool({ name: t.name, arguments: input as Record<string, unknown> });
          // Provenance-tagged. The runtime redacts our secrets from the audit preview;
          // the approval gate is the prompt-injection defense, not a scanner.
          return { server: opts.name, tool: t.name, isError: res.isError ?? false, content: res.content };
        },
      });
    });

  const provider = defineProvider({ id: providerId, displayName: `MCP: ${opts.name}`, auth: bearer() });
  registry.addBundle({
    provider,
    toolkits: [defineToolkit({ id: providerId, providerId, displayName: `MCP: ${opts.name}`, actions })],
  });

  // A connection so `runAction` resolves it (1 connection → use it) and the gates run.
  // For a no-auth / static-token server the credential is vestigial; for an OAuth MCP
  // server the host can later swap the strategy and drive beginAuth/completeAuth.
  const ownerId = opts.ownerId ?? 'local';
  const now = new Date().toISOString();
  const connection: Connection = {
    id: opts.connectionId ?? newId(),
    ownerId,
    providerId,
    accountId: opts.name,
    label: opts.name,
    scopes: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await store.save(connection, await secretBox.seal({ type: 'bearer', token: opts.sessionToken ?? 'mcp-session' }));

  return {
    providerId,
    toolkitId: providerId,
    connectionId: connection.id,
    toolCount: actions.length,
    tools: tools.map((t) => ({ name: t.name, description: t.description })),
  };
}
