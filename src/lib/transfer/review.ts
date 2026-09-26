/**
 * Open code here on this computer (docs/homes-spec.md §8.1, P4.1): the
 * execution's latest published commit, checked out for review in a folder of
 * this computer's own, from its own clone of the agent's repository. The
 * execution keeps running where it is, and nothing here is published to it.
 * Git and the filesystem only, so the home and a worker run the same code.
 */

import { getWorkDir } from '@/lib/config/paths';
import type { ReviewCheckoutAnswer } from '@/lib/workers/protocol';
import { CheckpointError, publishedCommit, reviewCheckout, reviewPathFor } from './git-checkpoint';

export async function reviewHere(args: {
  repo: string | null;
  executionId: string;
  workspaceSlug: string;
  branch: string;
  sourceName: string;
}): Promise<ReviewCheckoutAnswer> {
  if (!args.repo) return { ok: false, code: 'not_set_up', message: "The agent isn't set up on this computer. Attach its folder here first." };
  const published = await publishedCommit(args.repo, args.branch);
  if (!published) {
    return {
      ok: false,
      code: 'not_published',
      message: `Nothing of it is published yet: ${args.branch} isn't on the remote. Commit and push on ${args.sourceName}, or wait for the agent to.`,
    };
  }
  try {
    const result = await reviewCheckout({
      repo: args.repo,
      path: reviewPathFor(getWorkDir(), args.workspaceSlug, args.executionId),
      checkpoint: { remote: published.remote, branch: args.branch, sha: published.sha },
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, code: 'failed', message: err instanceof CheckpointError || err instanceof Error ? err.message : String(err) };
  }
}
