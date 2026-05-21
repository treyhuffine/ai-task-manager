'use client';

import { GitCommit } from 'lucide-react';
import { ActionButton } from './action-button';
import { useCommit, useRuntimeStatus } from '@/hooks/use-execution';

interface CommitButtonProps {
  sessionId: string;
  variant?: 'primary' | 'secondary';
  pendingCount?: number;
  /** Push to origin after the commit lands. */
  andPush?: boolean;
  /** Override the button label (defaults to "Commit" or "Commit & push"). */
  label?: string;
}

/**
 * "Commit" — injects a prompt asking the agent to draft a focused
 * message from the diff and run `git commit` (optionally chaining a
 * push). Same shape as `<OpenPrButton>`: no modal, no message input,
 * the agent owns the message. Disabled while a turn is in flight so we
 * don't queue another message on top.
 */
export function CommitButton({
  sessionId,
  variant = 'primary',
  pendingCount,
  andPush,
  label,
}: CommitButtonProps) {
  const commit = useCommit(sessionId);
  const { data: runtime } = useRuntimeStatus(sessionId);
  const isRunning = runtime?.running ?? false;

  const resolvedLabel = label ?? (andPush ? 'Commit & push' : 'Commit');
  return (
    <ActionButton
      icon={<GitCommit size={11} />}
      label={resolvedLabel}
      count={pendingCount}
      pending={commit.isPending}
      disabled={isRunning}
      onClick={() => commit.mutate(andPush ? { andPush: true } : undefined)}
      variant={variant}
      title={
        isRunning
          ? 'Wait for the current turn to finish'
          : andPush
            ? 'Ask the agent to commit and push'
            : 'Ask the agent to commit the current changes'
      }
    />
  );
}
