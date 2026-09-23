import type { HarnessAuthResponse } from '@/app/api/harness/auth/route';
import type { HarnessVerifyResponse } from '@/app/api/harness/verify/route';
import type { Attachment } from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';

/** Wire shape returned by /api/harness/auth — imported so client and server
 *  share a single source of truth. */
export type HarnessAuthReport = HarnessAuthResponse;

export interface HarnessVerifyState {
  phase: 'idle' | 'running' | 'ok' | 'failed' | 'skipped';
  result?: HarnessVerifyResponse;
  error?: string;
}

export interface HarnessAuthState {
  phase: 'idle' | 'checking' | 'ready' | 'error';
  report?: HarnessAuthReport;
  error?: string;
  /** Real round-trip verification that follows the fast auth check. Runs
   *  automatically once auth reports a usable path so the user can't reach
   *  the next step without confirming the agent actually responds. */
  verify: HarnessVerifyState;
  /** Explicit acknowledgement that the user accepts metered API-key billing
   *  when no subscription is available. Required to leave the Agent step in
   *  the api-key-only path. */
  acceptsApiKeyBilling: boolean;
}

export interface WizardState {
  name: string;
  description: string;
  areas: Array<{ name: string; emoji: string | null; attachments: Attachment[] }>;
  harness: HarnessId;
  /** Explicit default model id for the chosen provider. */
  model: string;
  harnessAuth: HarnessAuthState;
  /** User-level skill discovery for ordinary agent sessions in any project. */
  globalSkillEnabled: boolean | null;
  importSkipped: boolean;
}

export type StepId = 'you' | 'areas' | 'agent' | 'import' | 'launch';

export type WizardUpdate = (
  patch: Partial<WizardState> | ((s: WizardState) => Partial<WizardState>),
) => void;

export const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'you', label: 'You' },
  { id: 'agent', label: 'Harness' },
  { id: 'import', label: 'Import' },
  { id: 'areas', label: 'Areas' },
  { id: 'launch', label: 'Launch' },
];
