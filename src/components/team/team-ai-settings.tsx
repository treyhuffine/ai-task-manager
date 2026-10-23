'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ResultPilotSettings } from '@/components/results/result-pilot-settings';
import { HarnessSettingsPanel } from '@/components/settings/harness-settings-panel';
import { DefaultModelSection } from '@/components/settings/default-model-section';
import { useHomeContext } from '@/components/home/home-context';
import { SharedComputerWarning } from '@/components/home/shared-computer-warning';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { apiErrorText } from '@/lib/api/client';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTeamAiStatus } from './team-chat';

const button = 'inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/50 disabled:opacity-50';

/** Team AI configures the ordinary Home harnesses. The retired key is never selected. */
export function TeamAiSection() {
  const home = useHomeContext();
  const status = useTeamAiStatus();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.team.ai.status.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.team.ai.configuration.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.homeContext.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.homeExecutionChoices.queryKey() });
  };
  const onError = (error: unknown) => toast.error(apiErrorText(error));
  const toggle = useMutation({ mutationFn: (enabled: boolean) => trpcClient.team.ai.setEnabled.mutate({ enabled }), onSuccess: refresh, onError });
  const forget = useMutation({ mutationFn: () => trpcClient.team.ai.forgetKey.mutate(), onSuccess: refresh, onError });
  const canConfigure = home.capabilities.manageSignIns;
  return <section className="min-w-0 space-y-4">
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Team AI</h3>
      <p className="mt-2 text-sm" role="status">{!status.data ? 'Checking…' : !status.data.enabled ? 'Off. Tasks and notes work without AI.' : status.data.state === 'ready' ? "On. Runs on this team's server." : status.data.reason}</p>
      <p className="mt-1 text-xs text-muted-foreground">Team agents and chats are shared with everyone in this team.</p>
      <p className="mt-1 text-xs text-muted-foreground">GitHub controls use the GitHub account signed in on this Team server. Changes are also attributed here to the member requesting them.</p>
    </div>
    {canConfigure && <>
      {!status.data?.enabled && <SharedComputerWarning />}
      <button type="button" className={button} disabled={!status.data || toggle.isPending} onClick={async () => {
        if (status.data?.enabled && !await confirm({ title: 'Turn off Team AI?', description: 'Waiting messages are cancelled and work in progress stops. Chats stay readable.', confirmLabel: 'Turn off' })) return;
        toggle.mutate(!status.data?.enabled);
      }}>{status.data?.enabled ? 'Turn off' : 'Turn on'}</button>
      <div className="space-y-5">
        <p className="text-xs text-muted-foreground">Sign in on the server hosting this team. Everyone on the team uses this sign-in.</p>
        <DefaultModelSection />
        <HarnessSettingsPanel />
      </div>
      {status.data?.hasApiKey && <div className="space-y-2 rounded-md border border-border p-3">
        <p className="text-xs">The previous Team AI API key is saved and unused. Team agents use the harness sign-ins above.</p>
        <button className={button} disabled={forget.isPending} onClick={async () => {
          if (await confirm({ title: 'Remove the unused API key?', description: 'Current harness sign-ins and chat history are kept.', confirmLabel: 'Remove key', tone: 'destructive' })) forget.mutate();
        }}>Remove unused key</button>
      </div>}
    </>}
    <ResultPilotSettings canConfigure={home.capabilities.configureAgents} />
  </section>;
}
