'use client';
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react';
import { useMutationState } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useChatCapabilities } from '@/components/chat-ui/chat-capabilities';
import { Tip } from '@/components/ui/tip';
import { useOptionalWorkActivity, useOptionalWorkNavigation } from '@/contexts/work-context';
import { useArchiveExecution } from '@/hooks/use-archive-execution';
import { continueSessionMutationKey, useContinueSession, useSession } from '@/hooks/use-execution';
import { ARCHIVE_SESSION_MUTATION_KEY } from '@/hooks/use-workspaces';
import { apiErrorText } from '@/lib/api/client';

const buttonClass = 'inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

/**
 * Archive the chat a returned result came from, where the person reads the
 * result and decides the work is done. The chat saying it's done is only its
 * opinion, so this is a button and never automatic.
 *
 * It shows the chat as it is now, not as the message saw it: Archive while
 * it's active, Archived with Reopen once it isn't, whoever archived it (this
 * card, another card of the same chat, the rail, an agent, another device).
 * Only execution chats: an agent's main chat or Ri's that answered is a
 * conversation, not work to close out.
 */
export function ReturnedChatArchive({ sessionId }: { sessionId: string }) {
  const enabled = useChatCapabilities().coordination !== false;
  // Archiving leaves the chat if it's on screen, so it needs the document's navigation.
  const navigation = useOptionalWorkNavigation();
  const activity = useOptionalWorkActivity();
  return enabled && navigation && activity ? <AvailableReturnedChatArchive sessionId={sessionId} /> : null;
}

function AvailableReturnedChatArchive({ sessionId }: { sessionId: string }) {
  const { data: session } = useSession(sessionId);
  const { archive } = useArchiveExecution();
  const reopen = useContinueSession(sessionId);
  // In flight from any card or surface, so every card of this chat agrees.
  const archiving = useMutationState({
    filters: { mutationKey: ARCHIVE_SESSION_MUTATION_KEY, status: 'pending', predicate: mutation => (mutation.state.variables as { id?: string } | undefined)?.id === sessionId },
  }).length > 0;
  const reopening = useMutationState({ filters: { mutationKey: continueSessionMutationKey(sessionId), status: 'pending' } }).length > 0;
  if (session?.type !== 'execution') return null;
  const name = session.label ?? session.execution?.label ?? null;

  if (session.status === 'archived') {
    const onReopen = async () => {
      try {
        await reopen.mutateAsync(undefined);
      } catch (err) {
        toast.error(name ? `Couldn't reopen "${name}"` : "Couldn't reopen the chat", { description: apiErrorText(err) });
      }
    };
    return <div className="my-1.5 ml-auto mr-2.5 flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground" data-returned-chat="archived">
      <span className="inline-flex items-center gap-1"><Archive size={12} aria-hidden />Archived</span>
      <button type="button" disabled={reopening} onClick={() => void onReopen()} aria-label={name ? `Reopen ${name}` : undefined} className={buttonClass}>
        {reopening ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <ArchiveRestore size={12} aria-hidden />}
        {reopening ? 'Reopening…' : 'Reopen'}
      </button>
    </div>;
  }

  return <div className="my-1.5 ml-auto mr-2.5 flex shrink-0" data-returned-chat="active">
    <Tip label="Takes it off the rail. You can reopen it from here.">
      <button
        type="button"
        disabled={archiving}
        onClick={() => void archive({ id: session.id, executionId: session.executionId, workspaceId: session.workspaceId, label: name })}
        aria-label={name ? `Archive chat ${name}` : undefined}
        className={buttonClass}
      >
        {archiving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Archive size={12} aria-hidden />}
        {archiving ? 'Archiving…' : 'Archive chat'}
      </button>
    </Tip>
  </div>;
}
