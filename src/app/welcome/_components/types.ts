export type AgentAdapter = 'claude' | 'codex';

export interface WizardState {
  name: string;
  description: string;
  areas: Array<{ name: string; emoji: string }>;
  agentAdapter: AgentAdapter;
  agentModel: string;
  agentProbe: { status: 'idle' | 'running' | 'pass' | 'warn' | 'fail'; message?: string };
  importSkipped: boolean;
}

export type StepId = 'you' | 'areas' | 'agent' | 'import' | 'launch';

export const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'you', label: 'You' },
  { id: 'areas', label: 'Areas' },
  { id: 'agent', label: 'Agent' },
  { id: 'import', label: 'Import' },
  { id: 'launch', label: 'Launch' },
];
