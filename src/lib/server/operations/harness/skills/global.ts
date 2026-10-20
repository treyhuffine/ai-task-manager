import { APP_NAME } from '@/constants/app';
import { cleanupKnownProjectSkillLinks } from '@/lib/agent-skills/project-cleanup';
import {
  configureGlobalSkill,
  displayHomePath,
  getGlobalSkillPreference,
  inspectGlobalSkills,
  installAppRootSkills,
} from '@/lib/agent-skills/shipped';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * The saved choice (`enabled`, `configured`) and what's on disk (`installed`,
 * `conflicts`, in `folders`: every harness's folder for skills in every
 * project). They differ when someone deleted a link by hand or another skill
 * holds the name, and Settings shows what's on disk.
 */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  if (process.env.RI_DESKTOP === '1') {
    return reply({ appOnly: true, enabled: false, configured: true, installed: false, conflicts: [] as string[], folders: [] as string[] });
  }
  const preference = getGlobalSkillPreference();
  const { installed, conflicts, folders } = await inspectGlobalSkills();
  return reply({
    appOnly: false,
    enabled: preference === true,
    configured: preference !== null,
    installed,
    conflicts,
    folders,
  });
}

export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  try {
    const body = (rpcInput.body) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      return reply({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    if (process.env.RI_DESKTOP === '1') {
      const install = await installAppRootSkills();
      return reply({ enabled: false, appOnly: true, install }, { status: install.errors ? 500 : 200 });
    }
    const result = await configureGlobalSkill(body.enabled);
    const projectCleanup = await cleanupKnownProjectSkillLinks();

    if (result.enabled && result.install.errors > 0) {
      return reply(
        {
          error: `${APP_NAME}'s skills could not be installed`,
          result,
          projectCleanup,
        },
        { status: 500 },
      );
    }

    if (result.enabled && result.install.conflicts > 0) {
      const taken = result.install.entries
        .filter((entry) => entry.status === 'conflict')
        .map((entry) => displayHomePath(entry.targetPath));
      const one = taken.length === 1;
      return reply(
        {
          error: `Another skill is already at ${taken.join(', ')}, so ${APP_NAME} left ${one ? 'it' : 'them'} alone. Remove or rename ${one ? 'it' : 'them'}, then install again.`,
          result,
          projectCleanup,
        },
        { status: 409 },
      );
    }

    return reply({ ...result, projectCleanup });
  } catch (err) {
    return reply(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PUTInput = rpcZ.object({ body: rpcZ.object({ "enabled": rpcZ.boolean().optional() }).strict().default({}) }).strict();
