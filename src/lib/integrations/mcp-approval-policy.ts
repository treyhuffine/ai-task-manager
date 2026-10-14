/** Approval preferences are independent of a tool's advertised side effects. */
export const MCP_APPROVAL_POLICIES = ['writes', 'auto', 'ask'] as const;
export type McpApprovalPolicy = typeof MCP_APPROVAL_POLICIES[number];
export const DEFAULT_MCP_APPROVAL_POLICY: McpApprovalPolicy = 'writes';
export type McpToolApprovalMode = 'auto' | 'ask';
export interface McpToolApprovalOverride { enabled?: boolean; approvalMode?: McpToolApprovalMode; mutating?: boolean }
export type McpToolApprovalPatch = Omit<McpToolApprovalOverride, 'approvalMode'> & { approvalMode?: McpToolApprovalMode | null };

export interface McpApprovalPreferences {
  approvalPolicy?: McpApprovalPolicy;
  toolOverrides?: Record<string, McpToolApprovalOverride>;
}

export function mcpToolApprovalOverride(override: McpToolApprovalOverride | undefined): McpToolApprovalMode | undefined {
  // Earlier versions used mutating as the Ask first preference. Interpret it
  // only as permission, so existing choices never reclassify writes as reads.
  if (override?.approvalMode !== undefined) return override.approvalMode;
  if (override?.mutating === undefined) return undefined;
  return override.mutating ? 'ask' : 'auto';
}

export function resolveMcpToolApproval(
  server: McpApprovalPreferences, toolName: string, defaultPolicy: McpApprovalPolicy, mutating: boolean,
): McpToolApprovalMode {
  const override = mcpToolApprovalOverride(server.toolOverrides?.[toolName]);
  if (override) return override;
  const policy = server.approvalPolicy ?? defaultPolicy;
  if (policy === 'writes') return mutating ? 'ask' : 'auto';
  return policy;
}

/** Clear permission exceptions without turning disabled tools back on. */
export function clearMcpToolApprovals(overrides: McpApprovalPreferences['toolOverrides']): NonNullable<McpApprovalPreferences['toolOverrides']> {
  return Object.fromEntries(Object.entries(overrides ?? {}).flatMap(([name, override]) =>
    override.enabled === undefined ? [] : [[name, { enabled: override.enabled }]]));
}

/** Only enabled state goes to ingestion. Permission preferences never alter facts. */
export const mcpIngestOverrides = clearMcpToolApprovals;

export function patchMcpToolOverrides(current: McpApprovalPreferences['toolOverrides'], patches: Record<string, McpToolApprovalPatch>): NonNullable<McpApprovalPreferences['toolOverrides']> {
  // Remote tool names can include __proto__ or constructor. They are keys,
  // never JavaScript object properties with special behavior.
  const next: NonNullable<McpApprovalPreferences['toolOverrides']> = Object.assign(Object.create(null), current);
  for (const [name, patch] of Object.entries(patches)) {
    const override = { ...next[name], ...patch };
    if (patch.approvalMode !== undefined) delete override.mutating;
    if (override.approvalMode === null) delete override.approvalMode;
    if (Object.keys(override).length) next[name] = override as McpToolApprovalOverride;
    else delete next[name];
  }
  return next;
}
