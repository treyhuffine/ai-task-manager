/**
 * The device-local execution half of one-shot.ts. The home resolves its policy
 * and model first. A connected runner uses those supplied values without
 * reading the home's database or selecting a different harness.
 */
import { getProvider } from '@agentex/agent';
import { getAppRoot } from '@/lib/config/paths';
import { backgroundHarnessUnavailableReason } from '@/lib/executor/harness';
import { harnessDefinition, type HarnessId } from './registry';
import { runtimeContextForHarness } from './runtime';
import type { HarnessOneShotOpts, HarnessOneShotResult } from './one-shot';

const DEFAULT_DISALLOWED_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'Bash'];

export async function executeHarnessTextOnDevice(
  opts: Omit<HarnessOneShotOpts, 'tier' | 'requiredHarness'> & { harness: HarnessId },
): Promise<HarnessOneShotResult> {
  const unavailable = backgroundHarnessUnavailableReason(opts.harness);
  if (unavailable) throw new Error(`[${opts.label}] ${unavailable}`);
  opts.signal?.throwIfAborted();
  const providerType = harnessDefinition(opts.harness).agentexProviderId;
  const cwd = opts.cwd ?? getAppRoot();
  const runtime = await runtimeContextForHarness(opts.harness, { cwd });
  const hasMcp = (opts.mcpServers?.length ?? 0) > 0;
  const skipPermissions = opts.skipPermissions ?? !hasMcp;
  const result = await getProvider(providerType).execute({
    ...(opts.signal ? { signal: opts.signal } : {}),
    prompt: opts.system ? `${opts.system}\n\n---\n\n${opts.prompt}` : opts.prompt,
    ...(opts.model ? { model: opts.model } : {}),
    cwd, env: runtime.env,
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    config: {
      ...runtime.config,
      timeoutSec: opts.timeoutSec ?? 60,
      maxTurns: opts.maxTurns ?? 1,
      strictMcpConfig: true,
      ...(opts.extraArgs ? { extraArgs: opts.extraArgs } : {}),
      ...(opts.planMode !== undefined ? { planMode: opts.planMode } : {}),
      ...(hasMcp ? { mcpServers: opts.mcpServers } : {}),
      ...(opts.allowedTools?.length ? { allowedTools: opts.allowedTools } : {}),
      disallowedTools: opts.disallowedTools ?? DEFAULT_DISALLOWED_TOOLS,
      ...(skipPermissions ? { skipPermissions: true } : { unattendedPermissionPolicy: 'deny' as const }),
    },
  });
  const text = result.summary?.trim() ?? '';
  if (result.status !== 'completed' || !text) {
    throw new Error(`[${opts.label}] ${providerType} one-shot ${result.status}: ${result.errorMessage ?? 'no output'}`);
  }
  return { text, providerType, model: opts.model, raw: result };
}
