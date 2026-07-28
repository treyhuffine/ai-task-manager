import { Rocket, Check, User, Layers, Bot, Upload, Globe2 } from 'lucide-react';
import { APP_NAME } from '@/constants/app';
import type { WizardState } from './types';

const HARNESS_LABEL: Record<WizardState['agentHarness'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

function agentAuthSummary(state: WizardState): string {
  const auth = state.agentAuth;
  if (auth.phase !== 'ready' || !auth.report) return 'Authentication not verified';
  const { hasSubscription, hasApiKey, hasBedrock } = auth.report;
  if (hasSubscription && hasApiKey) return 'Subscription active (API key also set)';
  if (hasSubscription) return 'Subscription active';
  if (hasBedrock) return 'Using AWS Bedrock';
  if (hasApiKey && auth.acceptsApiKeyBilling) return 'Using API key (metered)';
  if (hasApiKey) return 'API key detected. Acknowledge metered billing on Agent step';
  return 'Verified via test request';
}

export function StepLaunch({ state }: { state: WizardState }) {
  const rows = [
    {
      icon: User,
      label: state.name || 'Unnamed',
      sub: state.description ? state.description.slice(0, 80) : 'No context yet',
    },
    {
      icon: Layers,
      label: `${state.areas.length} area${state.areas.length === 1 ? '' : 's'}`,
      sub: state.areas.map((a) => a.name).join(', ') || '-',
    },
    {
      icon: Bot,
      label: HARNESS_LABEL[state.agentHarness],
      sub: agentAuthSummary(state),
    },
    {
      icon: Globe2,
      label: 'Agent skill access',
      sub:
        state.globalSkillEnabled === false
          ? 'Available only inside the app'
          : 'Available in every project',
    },
    {
      icon: Upload,
      label: 'Import',
      sub: 'Skipped, set up later',
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <Rocket className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Ready to launch</h2>
          <p className="text-sm text-muted-foreground">
            Everything is set up. Launching will save your workspace and open {APP_NAME}.
          </p>
        </div>
      </header>

      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((row, i) => {
          const Icon = row.icon;
          return (
            <div key={i} className="flex items-center gap-3 p-4">
              <Icon className="size-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{row.label}</div>
                <div className="truncate text-xs text-muted-foreground">{row.sub}</div>
              </div>
              <Check className="size-5 text-emerald-500" />
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground/80">
        Agents can manage your tasks and notes from any project. You can change this anytime in Settings.
      </p>
    </div>
  );
}
