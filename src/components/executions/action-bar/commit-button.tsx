'use client';

import { useState } from 'react';
import { GitCommit } from 'lucide-react';
import { ActionButton } from './action-button';
import { CommitModal } from '../commit-modal';

interface CommitButtonProps {
  sessionId: string;
  variant?: 'primary' | 'secondary';
  pendingCount?: number;
  /** Auto-push to origin after the commit succeeds. */
  andPush?: boolean;
  /** Override the button label (defaults to "Commit…" or "Commit and push"). */
  label?: string;
}

/**
 * Opens the shared `<CommitModal>` for typing a commit message. The
 * modal handles the actual `ws.git.commit` call through `useCommit`,
 * and optionally chains a push when `andPush` is set.
 */
export function CommitButton({ sessionId, variant = 'primary', pendingCount, andPush, label }: CommitButtonProps) {
  const [open, setOpen] = useState(false);
  const resolvedLabel = label ?? (andPush ? 'Commit and push' : 'Commit…');
  return (
    <>
      <ActionButton
        icon={<GitCommit size={11} />}
        label={resolvedLabel}
        count={pendingCount}
        onClick={() => setOpen(true)}
        variant={variant}
        title={
          andPush
            ? 'Commit changes and push to origin'
            : 'Commit staged + unstaged changes'
        }
      />
      <CommitModal
        sessionId={open ? sessionId : null}
        onClose={() => setOpen(false)}
        andPush={andPush}
      />
    </>
  );
}
