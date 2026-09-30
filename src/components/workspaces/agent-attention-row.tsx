'use client';

import { useDashboard } from '@/contexts/dashboard-context';
import { AgentIcon } from '@/components/agents/agent-icon';
import { agentVoice } from '@/lib/utils/agent-rail';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { latestActivityAt } from '@/lib/utils/session-sort';
import type { AgentAttentionItem } from '@/hooks/use-agent-attention';
import { cn } from '@/lib/utils';

/**
 * An agent that wants you, in a list of things that want you. Each variant
 * takes the shape of the execution rows beside it, so the list reads as one:
 *
 *   - `rail`: the rail's Needs you group. A status dot, then the agent (a
 *     small icon and its name) over what it's saying.
 *   - `status`: the Status tab, whose rows lead with the agent's icon and
 *     whose section header already names the state.
 *   - `pill`: a header pill's popover, the same shape, tighter.
 *
 * The second line is what it's saying: the question it's waiting on, or its
 * reply. Opens the agent.
 */
export function AgentAttentionRow({
  item,
  variant = 'rail',
  onPick,
}: {
  item: AgentAttentionItem;
  variant?: 'rail' | 'status' | 'pill';
  onPick?: () => void;
}) {
  const { activeView, openAgent } = useDashboard();
  const { workspace, chat, activity } = item;
  const isActive = activeView.kind === 'agent' && activeView.id === workspace.id;
  const voice = agentVoice({ activity, waitingOn: chat.waitingOn, preview: chat.preview, purpose: workspace.purpose });
  const at = latestActivityAt(chat);
  const waiting = activity === 'waiting';

  const open = () => {
    openAgent(workspace.id);
    onPick?.();
  };
  const voiceClass = waiting ? 'text-amber-600 dark:text-amber-400' : 'text-foreground/75';
  const time = at ? formatCompactRelative(at) : null;

  if (variant === 'rail') {
    return (
      <button
        onClick={open}
        className={cn(
          'relative w-full flex items-start gap-2 pl-5 pr-1.5 py-1 rounded-md text-left transition-colors',
          isActive ? 'bg-secondary text-foreground' : 'hover:bg-muted/40',
        )}
        title={`${workspace.name}: ${voice.text}`}
      >
        <span className="flex h-4 items-center flex-shrink-0">
          <span
            aria-label={waiting ? 'Waiting on you' : 'New reply'}
            className={cn('w-2 h-2 rounded-full bg-amber-500', waiting && 'animate-pulse')}
          />
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <AgentIcon workspace={workspace} size="xs" />
            <span className="truncate text-[11px] font-semibold text-foreground">{workspace.name}</span>
            {time && <span className="ml-auto flex-shrink-0 text-[9px] text-muted-foreground/60">{time}</span>}
          </span>
          <span className={cn('mt-0.5 block truncate text-[10px] leading-tight', voiceClass)}>{voice.text}</span>
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={open}
      className={cn(
        'w-full flex items-start gap-1.5 text-left rounded-md transition-colors',
        variant === 'status' ? 'pl-4 pr-1.5 py-1.5' : 'px-2.5 py-1.5',
        isActive ? 'bg-secondary' : variant === 'status' ? 'hover:bg-muted/40' : 'hover:bg-muted/50',
      )}
      title={`${workspace.name}: ${voice.text}`}
    >
      <span className="relative flex-shrink-0">
        <AgentIcon workspace={workspace} size="sm" />
        {waiting && (
          <span aria-label="Waiting on you" className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-background animate-pulse" />
        )}
      </span>
      <span className="flex-1 min-w-0 leading-tight">
        <span className="block truncate text-[11.5px] font-semibold text-foreground/90">{workspace.name}</span>
        <span className={cn('mt-0.5 block truncate text-[10px]', voiceClass)}>{voice.text}</span>
      </span>
      {variant === 'status' && time && <span className="flex-shrink-0 text-[9px] text-muted-foreground/60 pt-px">{time}</span>}
    </button>
  );
}
