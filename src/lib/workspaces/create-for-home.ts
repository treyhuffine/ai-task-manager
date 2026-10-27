import path from 'node:path';
import type { CreateWorkspaceInput } from '@/db/types';
import type { RequestKey } from '@/lib/auth/request-key';
import * as q from '@/lib/db/queries';
import { authorizeTeamExecution } from '@/lib/home/execution-authority';
import { parseIntegrationScopes, validateIntegrationScopes } from '@/lib/integrations/scopes';
import { assertHomeFolderUsable, setHomeFolder, SetupError } from '@/lib/setups/home-context';
import { detectBaseBranch, detectIsGit } from '@/lib/workspaces';

type Input = Partial<CreateWorkspaceInput> & { name: string; cwd: string };
export class WorkspaceCreationError extends Error {
  constructor(readonly status: 400 | 409 | 500, message: string) { super(message); this.name = 'WorkspaceCreationError'; }
}

/** Personal filesystem and tool discovery are an explicit creation policy. */
async function creationPolicy(input: Input, key: RequestKey | null) {
  const authority = q.getHome()?.kind === 'team' ? authorizeTeamExecution(key, { operation: 'configure' }) : null;
  if (authority && input.defaultDeviceId && input.defaultDeviceId !== q.getHome()?.hostDeviceId) throw new q.TeamError('not_allowed', 'Team agents currently run on this server.');
  if (authority && input.integrationScopes?.length) throw new q.TeamError('not_allowed', 'Connectors are not available in a team.');
  const cwd = path.resolve(input.cwd);
  try { assertHomeFolderUsable(cwd); }
  catch (error) { if (error instanceof SetupError) throw new WorkspaceCreationError(400, error.message); throw error; }
  const isGit = input.isGit ?? await detectIsGit(cwd);
  const baseBranch = isGit ? input.baseBranch ?? await detectBaseBranch(cwd, input.remoteName ?? 'origin') : null;
  let integrationScopes: CreateWorkspaceInput['integrationScopes'] | undefined;
  if (input.integrationScopes !== undefined) {
    const parsed = parseIntegrationScopes(input.integrationScopes);
    if (!parsed) throw new WorkspaceCreationError(400, 'Provide valid connector scopes and account pins.');
    const result = await validateIntegrationScopes(parsed);
    if (!result.ok) throw new WorkspaceCreationError(400, result.error);
    integrationScopes = result.scopes;
  }
  return { cwd, isGit, baseBranch,
    worktreeRoot: isGit && input.worktreeRoot?.trim() ? input.worktreeRoot.trim() : null,
    browserEnabled: authority ? false : input.browserEnabled ?? true, integrationScopes, create: (values: Parameters<typeof q.createWorkspace>[0]) => {
      if (authority) authorizeTeamExecution(key, { operation: 'configure' });
      return q.createWorkspace({ ...values, ...(authority ? { createdByMemberId: authority.member.id, defaultDeviceId: q.getHome()!.hostDeviceId } : {}) });
    },
    finish: async (workspaceId: string) => {
      try { await setHomeFolder(workspaceId, cwd); }
      catch (error) {
        q.archiveWorkspace(workspaceId);
        throw new WorkspaceCreationError(error instanceof SetupError ? 409 : 500, `The agent's folder couldn't be set up: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

/** One creation operation and record shape. The policy supplies facts and placement only. */
export async function createWorkspaceForHome(input: Input, key: RequestKey | null) {
  const policy = await creationPolicy(input, key);
  const row = policy.create({
    name: input.name, slug: input.slug, emoji: input.emoji ?? null, attachments: input.attachments ?? [],
    cwd: policy.cwd, isGit: policy.isGit, baseBranch: policy.baseBranch,
    remoteName: policy.isGit ? input.remoteName ?? 'origin' : null, worktreeRoot: policy.worktreeRoot,
    ...(input.filesToCopy !== undefined ? { filesToCopy: input.filesToCopy } : {}),
    setupCommand: input.setupCommand ?? null, startCommand: input.startCommand ?? null, teardownCommand: input.teardownCommand ?? null,
    areaId: input.areaId ?? null,
    ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
    ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
    ...(input.workResultGuidance !== undefined ? { workResultGuidance: input.workResultGuidance } : {}),
    ...(input.reviewBeforeHandoff !== undefined ? { reviewBeforeHandoff: input.reviewBeforeHandoff } : {}),
    ...(input.reviewDefaults !== undefined ? { reviewDefaults: input.reviewDefaults } : {}),
    status: input.status ?? 'active', browserEnabled: policy.browserEnabled,
    ...(policy.integrationScopes !== undefined ? { integrationScopes: policy.integrationScopes } : {}),
  });
  await policy.finish?.(row.id);
  return row;
}
