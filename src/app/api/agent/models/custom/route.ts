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
import { isHarnessId } from '@/lib/agents/registry';
import { addCustomHarnessModel, removeCustomHarnessModel } from '@/lib/db/queries';
import { customModelOption, normalizeCustomModelId } from '@/lib/agent-options';

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!isHarnessId(body.harness)) return Response.json({ error: 'Unknown harness' }, { status: 400 });
    const modelId = typeof body.modelId === 'string' ? normalizeCustomModelId(body.modelId) : null;
    if (!modelId) {
      return Response.json(
        { error: 'Enter a model ID with no spaces, for example claude-opus-4-8' },
        { status: 400 },
      );
    }
    const settings = addCustomHarnessModel(body.harness, modelId);
    return Response.json({ settings, model: customModelOption(modelId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const harness = params.get('harness');
    const modelId = params.get('modelId')?.trim();
    if (!isHarnessId(harness)) return Response.json({ error: 'Unknown harness' }, { status: 400 });
    if (!modelId) return Response.json({ error: 'modelId is required' }, { status: 400 });
    return Response.json({ settings: removeCustomHarnessModel(harness, modelId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
