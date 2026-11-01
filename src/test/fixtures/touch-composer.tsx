import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatInputEditor, type ChatInputEditorHandle } from '@/components/chat/editor/chat-input-editor';
import { ExecutionComposer } from '@/components/executions/execution-composer';
import type { SlashCommand } from '@/components/chat/editor/slash-menu/types';
import type { MentionEntitySearch, MentionEntityResults } from '@/components/chat/editor/mention-menu/types';
import { TipProvider } from '@/components/ui/tip';
import { WorkContext, type WorkActivity, type WorkNavigation } from '@/contexts/work-context';

// Three message boxes, none told how Enter behaves, beside the one box that
// is told: the real execution composer (every chat's), the bare editor with
// an @ and a / menu behind it, and a feedback box that is always multi-line
// (`submitOnEnter={false}`). What each sends is recorded in `sent`. No server
// behind it: the composer's own queries fail and it renders without them.
const tasks = [
  { kind: 'task' as const, id: 'task-trash', title: 'Take out trash', status: 'todo' },
  { kind: 'task' as const, id: 'task-deploy', title: 'Deploy keys', status: 'todo' },
];

async function searchMentionEntities(search: MentionEntitySearch): Promise<MentionEntityResults> {
  const found = search.kind === 'note' ? [] : tasks.filter(task => task.title.toLowerCase().includes(search.q.toLowerCase()));
  await new Promise(resolve => setTimeout(resolve, 15));
  return { tasks: found.slice(0, search.limit), notes: [], totals: { tasks: found.length, notes: 0 } };
}

const slashCommands: SlashCommand[] = [{
  id: 'review', name: 'review', description: 'Review the diff', source: 'installed-user', userInvocable: true, available: true,
  execution: { kind: 'provider-slash', provider: 'claude', commandText: '/review' },
}];

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const navigation: WorkNavigation = { openAgent() {}, openExecution() {}, openTask() {}, openNote() {}, goHome() {} };
const activity: WorkActivity = {
  activeSessionId: null, streamingSessionIds: new Set(), backgroundSessionIds: new Set(), pendingInputSessionIds: new Set(),
  setActiveExecutionId() {}, setSessionStreaming() {},
};

type Box = 'composer' | 'editor' | 'feedback';
const sent: { box: Box; text: string }[] = [];

declare global {
  interface Window {
    touchComposer: { sent(): { box: Box; text: string }[]; text(box: 'editor' | 'feedback'): string; reset(): void };
  }
}

function Fixture() {
  const editor = useRef<ChatInputEditorHandle>(null);
  const feedback = useRef<ChatInputEditorHandle>(null);
  useEffect(() => {
    window.touchComposer = {
      sent: () => [...sent],
      text: (box) => (box === 'editor' ? editor : feedback).current?.getMarkerOutput().text ?? '',
      reset: () => { editor.current?.clear(); feedback.current?.clear(); sent.length = 0; },
    };
  }, []);
  const record = (box: 'editor' | 'feedback') => () => {
    const ref = box === 'editor' ? editor : feedback;
    sent.push({ box, text: ref.current?.getMarkerOutput().text ?? '' });
    ref.current?.clear();
  };
  return (
    <QueryClientProvider client={client}>
      <TipProvider>
        <WorkContext navigation={navigation} activity={activity}>
          <main style={{ display: 'grid', gap: 24, padding: '200px 12px 12px', maxWidth: 680 }}>
            <section aria-label="Composer">
              <ExecutionComposer
                sessionId="" autoFocus={false} permissionMode="auto_all" harness={null} model={null} effort={null}
                onSend={(text) => { sent.push({ box: 'composer', text }); }}
              />
            </section>
            <section aria-label="Editor" style={{ border: '1px solid #ccc', padding: 8 }}>
              <ChatInputEditor
                ref={editor} ariaLabel="Editor" attachmentsEnabled={false} onSubmit={record('editor')}
                slashCommands={slashCommands} searchMentionEntities={searchMentionEntities}
                mentionFiles={[{ kind: 'file', path: 'README.md', name: 'README.md' }]}
              />
            </section>
            <section aria-label="Feedback" style={{ border: '1px solid #ccc', padding: 8 }}>
              <ChatInputEditor ref={feedback} ariaLabel="Feedback" attachmentsEnabled={false} submitOnEnter={false} onSubmit={record('feedback')} />
            </section>
          </main>
        </WorkContext>
      </TipProvider>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
