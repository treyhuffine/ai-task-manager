'use client';



import { useOptionalHomeContext } from '@/components/home/home-context';

import type { WorkspaceRecord } from '@/db/types';
import { FolderPicker } from './folder-picker';

/** Configuration policy is supplied once, separately from the shared form fields. */
export function useAgentConfigurationScope() {
  const home = useOptionalHomeContext();
  return {
    canConfigure: home?.capabilities.configureAgents ?? true,
    personalTools: home?.capabilities.privatePlanning ?? true,
    executionChoices: home?.executionChoices ?? [],
  };
}

export function AgentCreationFolder({ cwd, onChange, onDismiss }: {
  cwd: string; onChange: (value: string) => void; onDismiss: () => void;
}) {
  return <>
    <FolderPicker value={cwd} onChange={onChange} placeholder="Choose folder…" autoOpen onDismiss={onDismiss} />
    <p className="mt-1 text-[10px] text-muted-foreground/70">Git is detected automatically. Plain folders work too.</p>
  </>;
}

export function AgentPinnedFolder({ workspace }: { workspace: WorkspaceRecord }) {
  const { executionChoices } = useAgentConfigurationScope();
  return <section className="space-y-2">
    <h3 className="text-sm font-semibold">Execution destination</h3>
    <p className="text-xs text-muted-foreground">{executionChoices[0]?.name ?? "This team's server"}</p>
    <p className="break-all font-mono text-xs">{workspace.cwd}</p>
    <p className="text-[11px] text-muted-foreground">Chats run on this team&apos;s server and are visible to every team member.</p>
  </section>;
}
