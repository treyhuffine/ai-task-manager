import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Open code here (docs/homes-spec.md §8.1, P4.1): a review checkout of the
 * execution's latest published commit on the viewer's own device, a
 * browser linked to it or the home's own browser. The execution keeps
 * running where it is. GET says what this device has (or, with
 * `?device=`, what that one has, for Continue there to mention), POST
 * makes or refreshes it (refreshed only while clean: edits there are kept).
 */

import { getRequestKey } from '@/lib/auth/request-key';
import { getChatSessionWithExecution, getDevice, getDeviceForApiKey, getHome, getReviewCheckout, getWorkspace, listWorkspaceSetups, placementOf, saveReviewCheckout } from '@/lib/db/queries';
import { reviewHere } from '@/lib/transfer/review';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import type { ReviewCheckoutAnswer, ReviewCheckoutRequest } from '@/lib/workers/protocol';

/** The device this browser is on: the one its key is linked to, or the home's own for its own browser. */
function viewerDevice(request: OperationContext): { id: string; name: string } | null {
  const key = getRequestKey(request.headers);
  const linked = key && key.scope === 'viewer' ? getDeviceForApiKey(key.apiKeyId) : null;
  if (linked) return { id: linked.id, name: linked.name };
  if (request.headers.get('x-ri-host') === '1') {
    const host = getHome()?.hostDeviceId;
    const device = host ? getDevice(host) : null;
    if (device) return { id: device.id, name: device.name };
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
    source: record.sourceDeviceId ? { deviceId: record.sourceDeviceId, name: getDevice(record.sourceDeviceId)?.name ?? 'another device' } : null,
    updatedAt: record.updatedAt,
  };
}

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  const ctx = context(id);
  if (!ctx) return reply({ error: 'Session not found' }, { status: 404 });
  const viewer = viewerDevice(request);
  const on = new URL(request.url).searchParams.get('device') ?? viewer?.id ?? null;
  return reply({
    viewer,
    review: on ? view(getReviewCheckout(ctx.executionId, on)) : null,
  });
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  const ctx = context(id);
  if (!ctx) return reply({ error: 'Session not found' }, { status: 404 });
  const viewer = viewerDevice(request);
  const sourceName = getDevice(ctx.placement.deviceId)?.name ?? 'its device';
  if (!viewer) {
    return reply({ error: 'not_here', message: 'Open code here from a browser on a computer that runs agents. A phone follows the work instead.' }, { status: 403 });
  }
  if (viewer.id === ctx.placement.deviceId) {
    return reply({ error: 'runs_here', message: `It runs on ${viewer.name} already: open its folder directly.` }, { status: 409 });
  }
  if (!ctx.workspace.isGit) {
    return reply({ error: 'not_git', message: "Work that isn't in a Git repository can't be opened on another device." }, { status: 409 });
  }
  const branch = ctx.session.branchName;
  if (!branch) return reply({ error: 'no_branch', message: `It has no branch yet on ${sourceName}.` }, { status: 409 });

  const host = getHome()?.hostDeviceId ?? null;
  let answer: ReviewCheckoutAnswer;
  if (viewer.id === host) {
    const setup = listWorkspaceSetups({ workspaceId: ctx.workspace.id }).find((s) => s.deviceId === host);
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
        return reply({ error: 'unavailable', message: `${viewer.name}'s worker isn't connected. Start it, then try again.` }, { status: 409 });
      }
      if (err instanceof WorkerRequestError) return reply({ error: 'worker_error', message: err.message }, { status: 424 });
      throw err;
    }
  }
  if (!answer.ok) return reply({ error: answer.code, message: answer.message }, { status: 409 });
  const record = saveReviewCheckout({
    executionId: ctx.executionId,
    deviceId: viewer.id,
    sourceDeviceId: ctx.placement.deviceId,
    path: answer.path,
    branch,
    commitSha: answer.sha,
    dirty: answer.dirty,
  });
  return reply({ viewer, review: view(record), created: answer.created, refreshed: answer.refreshed, inTheWay: answer.inTheWay ?? [] });
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "device": rpcZ.string().optional() }).strict().optional() }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
