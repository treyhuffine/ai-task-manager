/**
 * Open code here (docs/homes-spec.md §8.1, P4.1): a review checkout of the
 * execution's latest published commit on the viewer's own computer, a
 * browser linked to it or the home's own browser. The execution keeps
 * running where it is. GET says what this computer has, POST makes or
 * refreshes it (refreshed only while clean: edits there are kept).
 */

import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getComputer, getComputerForApiKey, getHome, getReviewCheckout, getWorkspace, listAgentSetups, placementOf, saveReviewCheckout } from '@/lib/db/queries';
import { getRequestKey } from '@/lib/auth/request-key';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import type { ReviewCheckoutAnswer, ReviewCheckoutRequest } from '@/lib/workers/protocol';
import { reviewHere } from '@/lib/transfer/review';

/** The computer this browser is on: the one its key is linked to, or the home's own for its own browser. */
function viewerComputer(request: Request): { id: string; name: string } | null {
  const key = getRequestKey(request.headers);
  const linked = key && key.scope === 'viewer' ? getComputerForApiKey(key.apiKeyId) : null;
  if (linked) return { id: linked.id, name: linked.name };
  if (request.headers.get('x-ri-host') === '1') {
    const host = getHome()?.hostComputerId;
    const computer = host ? getComputer(host) : null;
    if (computer) return { id: computer.id, name: computer.name };
  }
  return null;
}

function context(id: string) {
  const session = getChatSessionWithExecution(id);
  if (!session?.executionId || !session.workspaceId) return null;
  const workspace = getWorkspace(session.workspaceId);
  const placement = placementOf(session.executionId);
  if (!workspace || !placement) return null;
  return { session, workspace, placement, executionId: session.executionId };
}

function view(record: ReturnType<typeof getReviewCheckout>) {
  if (!record) return null;
  return {
    path: record.path,
    sha: record.commitSha,
    branch: record.branch,
    dirty: record.dirty,
    source: record.sourceComputerId ? { computerId: record.sourceComputerId, name: getComputer(record.sourceComputerId)?.name ?? 'another computer' } : null,
    updatedAt: record.updatedAt,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = context(id);
  if (!ctx) return Response.json({ error: 'Session not found' }, { status: 404 });
  const viewer = viewerComputer(request);
  return Response.json({
    viewer,
    review: viewer ? view(getReviewCheckout(ctx.executionId, viewer.id)) : null,
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = context(id);
  if (!ctx) return Response.json({ error: 'Session not found' }, { status: 404 });
  const viewer = viewerComputer(request);
  const sourceName = getComputer(ctx.placement.computerId)?.name ?? 'its computer';
  if (!viewer) {
    return Response.json({ error: 'not_here', message: 'Open code here from a browser on your computer. A phone follows the work instead.' }, { status: 403 });
  }
  if (viewer.id === ctx.placement.computerId) {
    return Response.json({ error: 'runs_here', message: `It runs on ${viewer.name} already: open its folder directly.` }, { status: 409 });
  }
  if (!ctx.workspace.isGit) {
    return Response.json({ error: 'not_git', message: "Work that isn't in a Git repository can't be opened on another computer." }, { status: 409 });
  }
  const branch = ctx.session.branchName;
  if (!branch) return Response.json({ error: 'not_published', message: `It has no branch yet on ${sourceName}.` }, { status: 409 });

  const host = getHome()?.hostComputerId ?? null;
  let answer: ReviewCheckoutAnswer;
  if (viewer.id === host) {
    const setup = listAgentSetups({ workspaceId: ctx.workspace.id }).find((s) => s.computerId === host);
    answer = await reviewHere({
      repo: setup?.sourcePath ?? ctx.workspace.cwd,
      executionId: ctx.executionId,
      workspaceSlug: ctx.workspace.slug,
      branch,
      sourceName,
    });
  } else {
    const ask: ReviewCheckoutRequest = { executionId: ctx.executionId, workspace: { id: ctx.workspace.id, slug: ctx.workspace.slug }, branch, sourceName };
    try {
      answer = (await requestWorker(viewer.id, 'review_checkout', ask, 120_000)) as ReviewCheckoutAnswer;
    } catch (err) {
      if (err instanceof WorkerUnavailableError) {
        return Response.json({ error: 'unavailable', message: `${viewer.name}'s worker isn't connected. Start it, then try again.` }, { status: 409 });
      }
      if (err instanceof WorkerRequestError) return Response.json({ error: 'worker_error', message: err.message }, { status: 424 });
      throw err;
    }
  }
  if (!answer.ok) return Response.json({ error: answer.code, message: answer.message }, { status: 409 });
  const record = saveReviewCheckout({
    executionId: ctx.executionId,
    computerId: viewer.id,
    sourceComputerId: ctx.placement.computerId,
    path: answer.path,
    branch,
    commitSha: answer.sha,
    dirty: answer.dirty,
  });
  return Response.json({ viewer, review: view(record), created: answer.created, refreshed: answer.refreshed });
}
