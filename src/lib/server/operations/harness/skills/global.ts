import { AGENT_SKILL_NAME } from '@/constants/app';
import { cleanupKnownProjectSkillLinks } from '@/lib/agent-skills/project-cleanup';
import {
  configureGlobalSkill,
  getGlobalSkillPreference,
  installAppRootSkills,
} from '@/lib/agent-skills/shipped';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  if (process.env.RI_DESKTOP === '1') return reply({ enabled: false, configured: true, appOnly: true });
  const preference = getGlobalSkillPreference();
  return reply({
    appOnly: false,
    enabled: preference === true,
    configured: preference !== null,
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
          error: 'The user-level skill could not be installed',
          result,
          projectCleanup,
        },
        { status: 500 },
      );
    }

    if (result.enabled && result.install.conflicts > 0) {
      return reply(
        {
          error: `A user-level skill named ${AGENT_SKILL_NAME} already exists and was left unchanged`,
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
