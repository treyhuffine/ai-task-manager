/**
 * A transfer as screens show it (P4.2): where it's going, the stage it's at
 * in words, and, when it stopped, where and why and what can be done next.
 */

import type { ExecutionTransferRecord, TransferStage } from '@/db/types';

export interface TransferView {
  id: string;
  executionId: string;
  state: ExecutionTransferRecord['state'];
  stage: TransferStage;
  from: { computerId: string; name: string };
  to: { computerId: string; name: string };
  /** Set once the destination owns the work. */
  ownershipChanged: boolean;
  failedStage: TransferStage | null;
  error: string | null;
  heldCount: number;
  /** The untracked files chosen to go along, for Try again. */
  includeUntracked: string[];
  checkpoint: { branch: string; sha: string } | null;
  createdAt: string;
  finishedAt: string | null;
}

export function transferView(
  transfer: ExecutionTransferRecord,
  names: (computerId: string) => string,
): TransferView {
  return {
    id: transfer.id,
    executionId: transfer.executionId,
    state: transfer.state,
    stage: transfer.stage,
    from: { computerId: transfer.fromComputerId, name: names(transfer.fromComputerId) },
    to: { computerId: transfer.toComputerId, name: names(transfer.toComputerId) },
    ownershipChanged: transfer.toGeneration !== null,
    failedStage: transfer.failedStage,
    error: transfer.error,
    heldCount: transfer.heldEventIds.length,
    includeUntracked: transfer.includeUntracked,
    checkpoint: transfer.branch && transfer.checkpointSha ? { branch: transfer.branch, sha: transfer.checkpointSha } : null,
    createdAt: transfer.createdAt,
    finishedAt: transfer.finishedAt,
  };
}

/** The four steps a person sees (§8.2): Preparing, Saving work, Setting up MacBook, Continuing. */
export function transferStepLabel(stage: TransferStage, to: string): string {
  switch (stage) {
    case 'preparing':
    case 'stopping':
      return 'Preparing';
    case 'saving':
      return 'Saving work';
    case 'setting_up':
      return `Setting up ${to}`;
    case 'continuing':
    case 'done':
      return 'Continuing';
  }
}
