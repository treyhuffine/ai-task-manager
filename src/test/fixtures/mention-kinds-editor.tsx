import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatInputEditor, type ChatInputEditorHandle } from '@/components/chat/editor/chat-input-editor';
import type { MentionEntitySearch, MentionEntityResults } from '@/components/chat/editor/mention-menu/types';
import { TooltipProvider } from '@/components/ui/tooltip';

// The real composer with a small home behind its @ menu: tasks and notes whose
// titles start like kind names (`Take out trash`, `Notes from standup`), an
// agent, a pull request and files. Enter sends, recorded in `sent`.
const tasks = [
  { kind: 'task' as const, id: 'task-trash', title: 'Take out trash', status: 'todo' },
  { kind: 'task' as const, id: 'task-tax', title: 'Tax return', status: 'in_progress' },
  { kind: 'task' as const, id: 'task-deploy', title: 'Deploy keys', status: 'todo' },
];
const notes = [
  { kind: 'note' as const, id: 'note-standup', title: 'Notes from standup' },
  { kind: 'note' as const, id: 'note-ideas', title: 'Launch ideas' },
];

async function searchMentionEntities(search: MentionEntitySearch): Promise<MentionEntityResults> {
  const q = search.q.toLowerCase();
  const match = <T extends { title: string }>(rows: T[]) => rows.filter(row => row.title.toLowerCase().includes(q));
  const foundTasks = search.kind === 'note' ? [] : match(tasks);
  const foundNotes = search.kind === 'task' ? [] : match(notes);
  await new Promise(resolve => setTimeout(resolve, 15));
  return {
    tasks: foundTasks.slice(0, search.limit),
    notes: foundNotes.slice(0, search.limit),
    totals: { tasks: foundTasks.length, notes: foundNotes.length },
  };
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const sent: string[] = [];

function Fixture() {
  const ref = useRef<ChatInputEditorHandle>(null);
  useEffect(() => {
    Object.assign(window, {
      mentionKinds: {
        text: () => ref.current?.getMarkerOutput().text ?? '',
        sent: () => [...sent],
        reset: () => { ref.current?.clear(); sent.length = 0; },
      },
    });
  }, []);
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <div style={{ margin: '320px 12px 0', width: 'calc(100% - 24px)', maxWidth: 680 }}>
          <ChatInputEditor
            ref={ref}
            ariaLabel="Message"
            onSubmit={() => { sent.push(ref.current?.getMarkerOutput().text ?? ''); ref.current?.clear(); }}
            mentionFiles={[{ kind: 'file', path: 'README.md', name: 'README.md' }, { kind: 'file', path: 'src/app/page.tsx', name: 'page.tsx' }]}
            searchMentionEntities={searchMentionEntities}
            mentionAgents={[{ kind: 'agent', id: 'ws-finances', name: 'Finances', slug: 'finances', picture: { image: null, emoji: null }, purpose: 'Budgets and bills' }]}
            prs={[{ number: 193, title: 'Add SEO footer', state: 'OPEN', isDraft: false, headRefName: 'seo-footer', baseRefName: 'main', url: 'https://github.com/o/r/pull/193', updatedAt: '2026-10-29T00:00:00.000Z' }]}
          />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
