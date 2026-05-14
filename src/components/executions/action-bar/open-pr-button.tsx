'use client';

import { GitPullRequest } from 'lucide-react';
import { ActionButton } from './action-button';
import { useOpenPr } from '@/hooks/use-execution-actions';
import { useRuntimeStatus } from '@/hooks/use-execution';

interface OpenPrButtonProps {
  sessionId: string;
}

/**
 * "Open PR" — injects a prompt into the chat asking the agent to draft
 * a title/body and run `gh pr create`. Disabled while a turn is in
 * flight so we don't queue another message on top.
 */
export function OpenPrButton({ sessionId }: OpenPrButtonProps) {
  const openPr = useOpenPr(sessionId);
  const { data: runtime } = useRuntimeStatus(sessionId);
  const isRunning = runtime?.running ?? false;

  return (
    <ActionButton
      icon={<GitPullRequest size={11} />}
      label="Open PR"
      pending={openPr.isPending}
      disabled={isRunning}
      onClick={() => openPr.mutate()}
      variant="primary"
      title={
        isRunning
          ? 'Wait for the current turn to finish'
          : 'Ask the agent to commit, push, and open a PR'
      }
    />
  );
}
