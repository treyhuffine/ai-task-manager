'use client';

import type { ReactElement, ReactNode, Ref, RefObject } from 'react';
import { Plus } from 'lucide-react';
import { Tip } from '@/components/ui/tip';
import { RailFlyout } from './rail-flyout';
import { SessionHoverProvider } from './session-hover-context';
import { SessionHoverPreview } from './session-hover-preview';

/**
 * An agent's own chats beside the rail, using the Apps flyout's layout rules:
 * the collapsed agent's chooser, peeked by resting on the agent (agents first
 * and classic), or the agents-only rail's chats button, opened by a click
 * (`hoverOpens={false}`, no `onClick`). With `previews`, resting on a chat
 * shows its latest messages beside the flyout, as rail rows do.
 */
export function AgentChatsFlyout({
  name,
  enabled,
  hoverTarget,
  hoverOpens,
  onClick,
  onNewChat,
  previews = false,
  trigger,
  children,
}: {
  name: string;
  enabled: boolean;
  hoverTarget?: RefObject<HTMLElement | null>;
  hoverOpens?: boolean;
  /** Where a click on the trigger goes. Without it, a click holds the flyout. */
  onClick?: () => void;
  onNewChat: () => void;
  previews?: boolean;
  trigger: (props: { ref: Ref<HTMLButtonElement>; open: boolean; onClick?: () => void }) => ReactElement;
  children: ReactNode;
}) {
  if (!enabled) return trigger({ ref: null, open: false, onClick });
  return (
    <RailFlyout
      contentLabel={`${name} chats`}
      className="w-80"
      hoverTarget={hoverTarget}
      hoverOpens={hoverOpens}
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
      <SessionHoverProvider disabled={!previews}>
        <nav aria-label={`${name} chats`} className="min-h-0 flex-1 overflow-y-auto px-1 py-1.5">
          {children}
        </nav>
        {previews && <SessionHoverPreview />}
      </SessionHoverProvider>
    </RailFlyout>
  );
}
