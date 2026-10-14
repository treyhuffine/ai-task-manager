'use client';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe } from 'lucide-react';
import type { ReactNode } from 'react';
import { DEFAULT_MCP_APPROVAL_POLICY, MCP_APPROVAL_POLICIES, type McpApprovalPolicy } from '@/lib/integrations/mcp-approval-policy';

export const MCP_POLICY_LABELS: Record<McpApprovalPolicy, string> = {
  writes: 'Ask before writes', auto: 'Always allow', ask: 'Ask every time',
};

export function McpPermissionSelect({ value, inheritedLabel, label, busy, onChange }: {
  value: McpApprovalPolicy | null; inheritedLabel: string; label: string; busy: boolean;
  onChange: (policy: McpApprovalPolicy | null) => void;
}) {
  return <Select value={value ?? 'inherit'} disabled={busy}
    onValueChange={choice => onChange(choice === 'inherit' ? null : choice as McpApprovalPolicy)}>
    <SelectTrigger aria-label={label} className="w-full min-w-0 gap-3 rounded-lg text-xs @sm:w-auto [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate">
      <SelectValue>{value === null ? inheritedLabel : MCP_POLICY_LABELS[value]}</SelectValue>
    </SelectTrigger>
    <SelectContent position="popper" align="start">
      <SelectItem value="inherit" className="text-xs">{inheritedLabel}</SelectItem>
      {MCP_APPROVAL_POLICIES.map(policy => <SelectItem key={policy} value={policy} className="text-xs">{MCP_POLICY_LABELS[policy]}</SelectItem>)}
    </SelectContent>
  </Select>;
}

/** Keep a saved choice and its bulk action together, with room for both on phones. */
export function McpPermissionControls({ label, children }: { label: string; children: ReactNode }) {
  return <div role="group" aria-label={label} className="flex w-full flex-col gap-2 @sm:w-fit @sm:flex-row @sm:items-center">{children}</div>;
}

export function McpDefaultPermissions({ override, busy, serverCount, onChange, onApplyToAll }: {
  override: McpApprovalPolicy | null; busy: boolean; serverCount: number;
  onChange: (policy: McpApprovalPolicy | null) => void; onApplyToAll: () => void;
}) {
  return <section aria-label="Global MCP permissions" className="@container space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
    <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <Globe size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <h3 className="text-xs font-medium">Global MCP default</h3>
          <p className="text-[11px] leading-normal text-muted-foreground">Used by new servers and servers set to Use global default.</p>
        </div>
      </div>
      <McpPermissionControls label="Global MCP default and bulk action">
        <McpPermissionSelect value={override} inheritedLabel="App default"
          label="Default MCP permissions" busy={busy} onChange={onChange} />
        {serverCount > 0 && <Button variant="outline" size="sm" className="h-9 text-xs" disabled={busy} onClick={onApplyToAll}>Apply to all servers</Button>}
      </McpPermissionControls>
    </div>
    <p className="text-[11px] leading-normal text-muted-foreground">
      {override === null && <>App default: {MCP_POLICY_LABELS[DEFAULT_MCP_APPROVAL_POLICY]}. </>}
      Saves immediately. Apply to all servers also replaces existing server and tool permission exceptions. Disabled tools stay off.
    </p>
  </section>;
}
