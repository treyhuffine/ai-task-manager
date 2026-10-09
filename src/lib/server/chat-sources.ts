import { ChatSources, SourceError } from '@/lib/chat-sources/service';
import { integrationSourceAdapter } from '@/lib/chat-sources/integration-adapter';
import { getChatEventById, getChatSessionWithExecution } from '@/lib/db/queries';
import { HARNESS_REGISTRY } from '@/lib/harness/registry';
import { isImportMirror } from '@/lib/import/mirror';
import { localAppsEnabled } from '@/lib/config/features';

export const chatSourcesEnabled = () => process.env.RI_CHAT_SOURCES === '1';
export const chatSources = new ChatSources({
  enabled: chatSourcesEnabled,
  message: getChatEventById,
  async context(chatId, qualified) {
    const chat = getChatSessionWithExecution(chatId);
    if (!chat || chat.status === 'archived' || isImportMirror(chat)) throw new SourceError('unavailable', 'This chat is unavailable');
    // Saved-result reviewers can inspect only their assigned result. A source
    // mention must not extend that scope, even when the Home enables apps.
    if (chat.surfaceKind === 'result_review') throw new SourceError('unavailable', 'App mentions are unavailable in review chats');
    const maximum = HARNESS_REGISTRY[chat.harness].maximumCapabilities;
    let harnessReady = maximum.mcp && maximum.strictMcpIsolation;
    if (qualified && harnessReady) {
      const runtime = await (await import('@/lib/harness/runtime')).getHarnessRuntime(chat.harness);
      harnessReady = runtime.capabilities.mcp.supported && runtime.capabilities.strictMcpIsolation.supported;
    }
    // Builder/fixture chats cannot use a mention to escape their restricted tool surface.
    if (chatSourcesEnabled() && localAppsEnabled()) {
      const { sourceChatAllowed } = await import('@/lib/local-apps/source-adapter');
      if (!sourceChatAllowed(chatId)) harnessReady = false;
    }
    return { chatId, workspaceId: chat.workspaceId, harnessReady };
  },
  async adapters() {
    const adapters = [integrationSourceAdapter];
    if (chatSourcesEnabled() && localAppsEnabled())
      adapters.push((await import('@/lib/local-apps/source-adapter')).localAppSourceAdapter);
    return adapters;
  },
});
