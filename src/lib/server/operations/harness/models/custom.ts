import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Pinned model ids — the escape hatch from the catalog.
 *
 * A provider catalog is always a little behind the provider (and Claude's
 * entries are tier aliases on purpose), so this route lets the user name an
 * exact build such as `claude-opus-4-8` and have every downstream validator
 * treat it as real. There is no reachability check: the point of a pin is to
 * reach a model this app cannot see yet, so the provider is the only authority
 * on whether it resolves, and it says so on the first send.
 */
import { addCustomHarnessModel, removeCustomHarnessModel } from '@/lib/db/queries';
import { customModelOption, normalizeCustomModelId } from '@/lib/harness/options';
import { isHarnessId } from '@/lib/harness/registry';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body = rpcInput.body as Record<string, unknown>;
    if (!isHarnessId(body.harness)) return reply({ error: 'Unknown harness' }, { status: 400 });
    const modelId = typeof body.modelId === 'string' ? normalizeCustomModelId(body.modelId) : null;
    if (!modelId) {
      return reply(
        { error: 'Enter a model ID with no spaces, for example claude-opus-4-8' },
        { status: 400 },
      );
    }
    const settings = addCustomHarnessModel(body.harness, modelId);
    return reply({ settings, model: customModelOption(modelId) });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, request: OperationContext) {
  try {
    const params = new URL(request.url).searchParams;
    const harness = params.get('harness');
    const modelId = params.get('modelId')?.trim();
    if (!isHarnessId(harness)) return reply({ error: 'Unknown harness' }, { status: 400 });
    if (!modelId) return reply({ error: 'modelId is required' }, { status: 400 });
    return reply({ settings: removeCustomHarnessModel(harness, modelId) });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "harness": rpcZ.enum(["cursor", "antigravity", "claude", "codex", "opencode"]), "modelId": rpcZ.string() }).strict() }).strict();
export const DELETEInput = rpcZ.object({ query: rpcZ.object({ "harness": rpcZ.string().optional(), "modelId": rpcZ.string().optional() }).strict().optional(), body: rpcZ.object({}).strict().default({}) }).strict();
