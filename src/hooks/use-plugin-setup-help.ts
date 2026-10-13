'use client';

import { useContext, useRef, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { useOptionalDashboard } from '@/contexts/dashboard-context';
import { closeSettings } from '@/components/settings/settings-store';
import { apiErrorText } from '@/lib/api/client';
import { sessionsApi } from '@/lib/api/sessions';
import { trpcClient } from '@/lib/trpc/client';
import { sendPluginSetupHelp, type PluginSetupHelpRequest } from '@/lib/client/plugin-setup-help';
import { pluginSetupHelpMessage, type PluginSetupHelpTarget } from '@/lib/plugins/setup-help';
import { mainChatKey } from './use-main-chat';

/** A setup handoff uses the app's existing main chat and ordinary message delivery. */
export function usePluginSetupHelp() {
  const dashboard = useOptionalDashboard();
  const qc = useContext(QueryClientContext);
  const inFlight = useRef(false);
  const request = useRef<PluginSetupHelpRequest | null>(null);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async (target: PluginSetupHelpTarget) => {
    if (!dashboard || inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null);
    try {
      const content = pluginSetupHelpMessage(target);
      if (!request.current || request.current.content !== content) request.current = { content, eventId: uuidv7() };
      const sessionId = await sendPluginSetupHelp(request.current, {
        ensureMainChat: () => trpcClient.orchestratorChat.list.query({}), sendMessage: sessionsApi.sendMessage,
      });
      request.current = null;
      void qc?.invalidateQueries({ queryKey: mainChatKey(null), exact: true });
      void qc?.invalidateQueries({ queryKey: ['session', sessionId] });
      closeSettings();
      dashboard.goHome();
      dashboard.showPanelTab('chat');
      dashboard.setFocusedPanel(dashboard.panelATab === 'chat' ? 'a' : dashboard.panelBTab === 'chat' ? 'b' : 'a');
      dashboard.setMobileTab('chat');
      if (dashboard.isFocusMode) dashboard.exitFocusMode();
    } catch (failure) {
      setError(`Could not ask your main agent. ${apiErrorText(failure)}`);
    } finally {
      inFlight.current = false; setPending(false);
    }
  };
  return { ask, isPending, error, available: !!dashboard };
}
