/**
 * ingestMcpServer (§12): the long-tail breadth strategy. An external MCP server is
 * registered as a **dynamic provider** whose tools become actions that proxy to it —
 * and those actions flow through the EXACT SAME `runAction` pipeline, so they get the
 * same approval gate, audit, and redaction as native connectors. They can't bypass
 * safety.
 *
 * Two safety properties this enforces (§12):
 *   - **Namespacing & provenance:** external action ids are `mcp.<server>.<tool>`;
 *     only a trusted host can select a built-in identity. Every result is tagged
 *     with its origin server.
 *   - **Default-conservative:** ingested tools are `mutating: true, risk: 'high'` until a
 *     host says otherwise → they hit the approval gate by default.
 *
 * Note (honest, per §12): secret-confinement on ingested output is real (the runtime
 * redacts our own bytes from audit). Prompt-injection is NOT solved by scanning — the
 * defense is structural: the approval gate sits in front of every side effect. We make
 * no injection-scanning claim.
 */
import { action, defineProvider, defineToolkit } from '../core/authoring';
import { z } from 'zod';
import { canonicalStringify } from '../core/digest';
import { jsonSchemaToZodObject } from './json-schema';
import { bearer } from '../auth/direct';
import { newId } from '../core/ids';
import { ConnectorError, NeedsReauthError } from '../core/errors';
import type { Registry } from '../core/registry';
import type { Action, Connection, ConnectionMetadata, ConnectionStore, Credentials, RiskLevel, SecretBox } from '../core/types';

export interface McpToolDef {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  _meta?: Record<string, unknown> & { ui?: { resourceUri?: string; visibility?: ('model' | 'app')[] } };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** The minimal MCP client surface ingestion needs (a test double or a real client). */
export interface McpClientLike {
  listTools(): Promise<{ tools: McpToolDef[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{
    content: unknown;
    structuredContent?: unknown;
    isError?: boolean;
    _meta?: Record<string, unknown>;
  }>;
}

export interface IngestMcpOptions {
  /** Short server name used for namespacing (`mcp.<name>.<tool>`). */
  name: string;
  client: McpClientLike;
  ownerId?: string;
  /**
   * Trusted host predicate for the authority/configuration this client captured.
   * Checked before every action so a cached runtime cannot outlive disabled tools,
   * credential replacement, or server reconfiguration in another process. Never
   * derive this from remote metadata. The host should compare its saved snapshot.
   */
  isCurrentTransport?: () => boolean;
  /**
   * Host-controlled identity for an official provider backed by MCP. Never derive
   * this from an external server's metadata. Omitting it keeps the MCP namespace.
   * The toolkit uses providerId, actions use `<providerId>.<remote tool name>`, and
   * accountId defaults to `<providerId>:default`.
   */
  identity?: { providerId: string; displayName: string; accountId?: string; authConfigId?: string; label?: string };
  /**
   * Trust read-only/destructive annotations from an official provider. Off for
   * arbitrary external servers: their self-reported annotations cannot bypass
   * approval. Explicit per-tool overrides take precedence.
   */
  trustToolAnnotations?: boolean;
  /** Default mutation risk, overriding trusted annotations when specified (otherwise `'high'`, or `'medium'` for a trusted non-destructive tool). */
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
   * duplicate each boot. Existing identity and connection metadata are retained,
   * with explicit identity.accountId taking precedence. Defaults to a fresh id.
   */
  connectionId?: string;
  /**
   * Per-tool reclassification (§12). Keyed by the remote tool name:
   *   - `enabled: false` → the tool is NOT ingested (hidden from the agent).
   *   - `mutating: false` → the tool reads-through the approval gate (for a trusted read tool).
   *   - `risk` overrides either the default or trusted annotation classification.
   * Tools absent from the map use trusted annotations, if enabled, then defaults.
   */
  toolOverrides?: Record<string, { enabled?: boolean; mutating?: boolean; risk?: RiskLevel }>;
}

export interface IngestMcpResult {
  providerId: string;
  toolkitId: string;
  connectionId: string;
  /** Number of tools actually ingested (after `enabled:false` overrides). */
  toolCount: number;
  /** Every tool the server advertised (incl. disabled), for the host to persist + render toggles. */
  tools: McpToolDef[];
}

export async function ingestMcpServer(
  registry: Registry,
  store: ConnectionStore,
  secretBox: SecretBox,
  opts: IngestMcpOptions,
): Promise<IngestMcpResult> {
  return (await ingestMcpServers(registry, store, secretBox, [opts]))[0]!;
}

/**
 * Register one canonical provider/toolkit backed by several account transports.
 * Discovery is the union of enabled tools. Approval uses the most conservative
 * classification across accounts, so a read can require approval when another
 * account exposes the same name as a mutation. Account validation is always exact.
 * The host must hold its lifecycle locks while publishing the prepared group.
 */
export async function ingestMcpServers(
  registry: Registry,
  store: ConnectionStore,
  secretBox: SecretBox,
  accounts: readonly IngestMcpOptions[],
): Promise<IngestMcpResult[]> {
  if (!accounts.length) return [];
  const identityOf = (opts: IngestMcpOptions) => {
    const safe = opts.name.replace(/[^a-zA-Z0-9_]/g, '_');
    return {
      providerId: opts.identity?.providerId ?? `mcp_${safe}`,
      displayName: opts.identity?.displayName ?? `MCP: ${opts.name}`,
      actionPrefix: opts.identity?.providerId ?? `mcp.${safe}`,
    };
  };
  const { providerId, displayName, actionPrefix } = identityOf(accounts[0]!);
  const ids = new Set<string>();
  type PreparedTool = { tool: McpToolDef; input: z.ZodObject<z.ZodRawShape>; mutating: boolean; risk: RiskLevel };
  const prepared: {
    opts: IngestMcpOptions; connection: Connection; tools: McpToolDef[];
    enabled: Map<string, PreparedTool>; sessionToken: string;
  }[] = [];
  for (const opts of accounts) {
    const identity = identityOf(opts);
    if (identity.providerId !== providerId || identity.actionPrefix !== actionPrefix || identity.displayName !== displayName) {
      throw new ConnectorError('conflict', 'MCP account groups must share one provider and toolkit identity.');
    }
    const connectionId = opts.connectionId ?? newId();
    if (ids.has(connectionId)) throw new ConnectorError('conflict', 'An MCP account group contains a duplicate connection id.');
    ids.add(connectionId);
    const previous = opts.connectionId ? (await store.get(opts.connectionId))?.connection : undefined;
    if (previous && (previous.providerId !== providerId || (opts.ownerId !== undefined && previous.ownerId !== opts.ownerId))) {
      throw new ConnectorError('conflict', 'The MCP connection id belongs to a different provider or owner.');
    }
    const now = new Date().toISOString();
    const connection: Connection = {
      ...previous, id: connectionId, ownerId: opts.ownerId ?? previous?.ownerId ?? 'local', providerId,
      accountId: opts.identity?.accountId ?? previous?.accountId ?? (opts.identity ? `${providerId}:default` : opts.name),
      ...(opts.identity?.authConfigId ? { authConfigId: opts.identity.authConfigId } : {}),
      label: opts.identity?.label ?? previous?.label ?? opts.identity?.displayName ?? opts.name,
      scopes: previous?.scopes ?? [], status: 'active', createdAt: previous?.createdAt ?? now, updatedAt: now,
    };
    const tools = structuredClone((await opts.client.listTools()).tools);
    const enabled = new Map<string, PreparedTool>();
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.name)) throw new ConnectorError('provider_error', `MCP server "${opts.name}" advertised duplicate tool "${tool.name}".`);
      names.add(tool.name);
      const override = opts.toolOverrides?.[tool.name];
      if (override?.enabled === false) continue;
      const annotations = opts.trustToolAnnotations ? tool.annotations : undefined;
      const mutating = override?.mutating ?? (annotations?.readOnlyHint === true ? false : opts.defaultMutating ?? true);
      const risk = override?.risk ?? (mutating
        ? opts.defaultRisk ?? (annotations?.destructiveHint === false ? 'medium' : 'high') : 'low');
      enabled.set(tool.name, { tool, input: jsonSchemaToZodObject(tool.inputSchema), mutating, risk });
    }
    prepared.push({ opts, connection, tools, enabled, sessionToken: opts.sessionToken ?? 'mcp-session' });
  }
  const byConnection = new Map(prepared.map(account => [account.connection.id, account]));
  const sameAccount = (expected: Connection, current: ConnectionMetadata) => expected.id === current.id
    && expected.providerId === current.providerId && expected.ownerId === current.ownerId && expected.accountId === current.accountId;
  const selectedTool = (connection: ConnectionMetadata, name: string, input: unknown) => {
    const account = byConnection.get(connection.id);
    if (!account || !sameAccount(account.connection, connection)) {
      throw new ConnectorError('connection_not_found', 'connection is not authenticated by this transport');
    }
    const selected = account.enabled.get(name);
    if (!selected) throw new ConnectorError('denied', `MCP tool "${name}" is not available for the selected account.`);
    const parsed = selected.input.safeParse(input);
    if (!parsed.success) throw new ConnectorError('invalid_input', parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '));
    return { account, selected, input: parsed.data };
  };
  const toolNames = [...new Set(prepared.flatMap(account => [...account.enabled.keys()]))];
  const riskOrder: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
  const actions: Action[] = toolNames.map(name => {
    const variants = prepared.flatMap(account => {
      const selected = account.enabled.get(name);
      return selected ? [{ ...selected, account }] : [];
    });
    const mutating = variants.some(variant => variant.mutating);
    const risk = variants.reduce<RiskLevel>((maximum, variant) => riskOrder[variant.risk] > riskOrder[maximum] ? variant.risk : maximum, 'low');
    const first = variants[0]!;
    const description = first.tool.description
      ? `${first.tool.description} (via MCP provider "${displayName}")`
      : `External MCP tool "${name}" from "${displayName}".`;
    const result = action({
      id: `${actionPrefix}.${name}`, description,
      input: unionInput(variants.map(variant => ({ schema: variant.tool.inputSchema, input: variant.input }))),
      mutating, risk,
      async execute(ctx, input) {
        const selected = selectedTool(ctx.connection, name, input);
        const { account } = selected;
        if (!mcpToolVisible(selected.selected.tool, ctx.toolAudience ?? 'model')) {
          throw new ConnectorError('denied', 'This tool is not available to this caller.');
        }
        if (account.opts.isCurrentTransport?.() === false) throw new NeedsReauthError(ctx.connection.id);
        let res: Awaited<ReturnType<McpClientLike['callTool']>>;
        try {
          res = await account.opts.client.callTool({ name, arguments: selected.input });
        } catch (error) {
          if (error instanceof ConnectorError || error instanceof NeedsReauthError) throw error;
          // Only the selected account's mutation can have crossed the wire.
          throw new ConnectorError('provider_unavailable', error instanceof Error ? error.message : String(error), {
            indeterminate: selected.selected.mutating, cause: error,
          });
        }
        if (res.isError) {
          const detail = remoteErrorMessage(res.content);
          throw new ConnectorError('provider_error', `MCP tool "${name}" from "${account.opts.name}" failed${detail ? `: ${detail}` : '.'}`);
        }
        // A host-owned channel, before the model projection. UI-only metadata
        // never enters the ordinary result, audit preview or transcript.
        ctx.captureOriginalResult?.(res);
        return { server: account.opts.name, tool: name, isError: false, content: res.content,
          ...(res.structuredContent !== undefined ? { structuredContent: res.structuredContent } : {}) };
      },
    });
    return { ...result, modelVisible: variants.some(variant => mcpToolVisible(variant.tool, 'model')),
      validateForConnection: (connection, input, audience = 'model') => {
        const selected = selectedTool(connection, name, input);
        if (!mcpToolVisible(selected.selected.tool, audience)) throw new ConnectorError('denied', 'This tool is not available to this caller.');
      } };
  });
  const bindingFor = (connection: Connection) => {
    const account = byConnection.get(connection.id);
    if (!account || !sameAccount(account.connection, connection) || account.connection.authConfigId !== connection.authConfigId) return undefined;
    return { isCurrentCredential: (credential: Credentials) => credential.type === 'bearer'
      && credential.token === account.sessionToken && (account.opts.isCurrentTransport?.() ?? true) };
  };
  const single = prepared.length === 1 ? prepared[0]! : undefined;
  const provider = defineProvider({
    id: providerId, displayName, auth: bearer(),
    externalAuth: { forConnection: bindingFor,
      ...(single ? { connectionId: single.connection.id, ...bindingFor(single.connection)! } : {}),
    },
  });
  registry.addBundle({ provider, toolkits: [defineToolkit({ id: providerId, providerId, displayName, actions })] });
  for (const account of prepared) {
    // Retain identity/client pins but replace only the host transport credential.
    await store.save(account.connection, await secretBox.seal({ type: 'bearer', token: account.sessionToken }));
  }
  return prepared.map(account => ({ providerId, toolkitId: providerId, connectionId: account.connection.id,
    toolCount: account.enabled.size, tools: account.tools }));
}

/** Invalid visibility fails closed. Omitted visibility allows both audiences. */
export function mcpToolVisible(tool: McpToolDef, audience: 'model' | 'app'): boolean {
  const visibility = tool._meta?.ui?.visibility;
  return visibility === undefined || (Array.isArray(visibility) && visibility.length > 0
    && visibility.every(value => value === 'model' || value === 'app') && visibility.includes(audience));
}

/** A projection object wide enough for every account, followed by exact account validation. */
function unionInput(variants: { schema: unknown; input: z.ZodObject<z.ZodRawShape> }[]): z.ZodObject<z.ZodRawShape> {
  if (variants.every(variant => canonicalStringify(variant.schema) === canonicalStringify(variants[0]!.schema))) return variants[0]!.input;
  const keys = new Set(variants.flatMap(variant => Object.keys(variant.input.shape)));
  const shape: z.ZodRawShape = {};
  for (const key of keys) {
    const alternatives = variants.map(variant => variant.input.shape[key] ?? z.unknown());
    shape[key] = z.union(alternatives as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]).optional();
  }
  return z.object(shape).passthrough();
}

/** MCP tool failures commonly put their actionable diagnostic in text blocks. */
function remoteErrorMessage(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block: unknown) => {
      if (!block || typeof block !== 'object') return [];
      const candidate = block as { type?: unknown; text?: unknown };
      return candidate.type === 'text' && typeof candidate.text === 'string' ? [candidate.text] : [];
    })
    .join('\n')
    .slice(0, 8_000);
}
