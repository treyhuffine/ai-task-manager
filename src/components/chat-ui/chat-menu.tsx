'use client';

import { MoreHorizontal } from 'lucide-react';
import { useChatCapabilities } from '@/components/chat-ui/chat-capabilities';
import { CoordinationSettings } from '@/components/chat-ui/coordination/controls';
import { RestartMenuItem } from '@/components/executions/restart-menu-item';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tip } from '@/components/ui/tip';
import { useRuntimeStatus } from '@/hooks/use-execution';

/**
 * A chat's ⋯ menu, for what stays away from everyday input: its standing
 * coordination preferences (personal chats) and Restart chat, for whoever
 * may stop it, personal or shared. Executions keep the same Restart in their
 * header's menu. Inline, Restart appears only while a chat is blocked
 * (`ChatRecovery`).
 */
export function ChatMenu({ sessionId }: { sessionId: string | null }) {
  return sessionId ? <SessionChatMenu sessionId={sessionId} /> : null;
}

function SessionChatMenu({ sessionId }: { sessionId: string }) {
  const coordination = useChatCapabilities().coordination !== false;
  const { data: runtime } = useRuntimeStatus(sessionId);
  const restart = runtime?.canStop !== false;
  if (!coordination && !restart) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Tip label={coordination ? 'Chat permissions, incoming messages and restart' : 'Restart this chat'}>
          <button type="button" aria-label="Chat menu" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <MoreHorizontal size={14} />
          </button>
        </Tip>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        {coordination && <div className="p-4"><CoordinationSettings sessionId={sessionId} /></div>}
        {restart && <div className={coordination ? 'border-t p-1' : 'p-1'}><RestartMenuItem sessionId={sessionId} /></div>}
      </PopoverContent>
    </Popover>
  );
}
