'use client';

import type { ReactElement, ReactNode, Ref, RefObject } from 'react';
import { Plus } from 'lucide-react';
import { Tip } from '@/components/ui/tip';
import { RailFlyout } from './rail-flyout';
import { SessionHoverProvider } from './session-hover-context';

/** The collapsed agent's own chats, using the Apps flyout's hover and layout rules. */
export function AgentChatsFlyout({
  name,
  enabled,
  hoverTarget,
  onClick,
  onNewChat,
  trigger,
  children,
}: {
  name: string;
  enabled: boolean;
  hoverTarget: RefObject<HTMLElement | null>;
  onClick: () => void;
  onNewChat: () => void;
  trigger: (props: { ref: Ref<HTMLButtonElement>; open: boolean; onClick?: () => void }) => ReactElement;
  children: ReactNode;
}) {
  if (!enabled) return trigger({ ref: null, open: false, onClick });
  return (
    <RailFlyout
      contentLabel={`${name} chats`}
      anchor="trigger"
      hoverTarget={hoverTarget}
      onClick={onClick}
      trigger={trigger}
    >
      <div className="flex min-h-8 flex-shrink-0 items-center gap-2 border-b border-border/40 px-3">
        <Tip label={`${name} chats`} onlyWhenTextHidden>
          <span className="min-w-0 flex-1 truncate text-[9px] font-bold uppercase tracking-[0.15em] text-foreground">
            {name} chats
          </span>
        </Tip>
        <Tip label="New chat">
          <button
            type="button"
            onClick={onNewChat}
            aria-label={`New chat with ${name}`}
            className="rounded bg-primary p-1 text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus size={12} />
          </button>
        </Tip>
      </div>
      <SessionHoverProvider disabled>
        <nav aria-label={`${name} chats`} className="min-h-0 overflow-y-auto px-1 py-1.5">
          {children}
        </nav>
      </SessionHoverProvider>
    </RailFlyout>
  );
}
