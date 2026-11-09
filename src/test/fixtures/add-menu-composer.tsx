import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ComposerAddMenu } from '@/components/chat-ui/add-menu/composer-add-menu';
import { ComposerMentionRows } from '@/components/chat-ui/add-menu/composer-mention-rows';
import { ChatInputEditor, type ChatInputEditorHandle } from '@/components/chat/editor/chat-input-editor';
import type { SlashCommand } from '@/components/chat/editor/slash-menu/types';
import { TipProvider } from '@/components/ui/tip';

// The + menu with the real editor it opens menus in. `?skills=0` is a composer
// with no available skills. What's picked and sent is recorded on `window`.
// No server behind it. The context shortcuts are shared before and after launch.
const slashCommands: SlashCommand[] = [{
  id: 'review', name: 'review', description: 'Review the diff', source: 'installed-user', userInvocable: true, available: true,
  execution: { kind: 'provider-slash', provider: 'claude', commandText: '/review' },
}];
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const skills = new URLSearchParams(location.search).get('skills') !== '0';

declare global {
  interface Window {
    addMenu: { picked(): string[]; sent(): string[]; text(): string };
  }
}

function Fixture() {
  const editor = useRef<ChatInputEditorHandle>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const sent = useRef<string[]>([]);
  useEffect(() => {
    window.addMenu = {
      picked: () => picked,
      sent: () => [...sent.current],
      text: () => editor.current?.getMarkerOutput().text ?? '',
    };
  }, [picked]);
  return (
    <QueryClientProvider client={client}>
      <TipProvider>
        <main style={{ padding: '420px 12px 12px', maxWidth: 680 }}>
          <ChatInputEditor
            ref={editor}
            ariaLabel="Message"
            attachmentsEnabled={false}
            slashCommands={skills ? slashCommands : undefined}
            mentionFiles={[{ kind: 'file', path: 'README.md', name: 'README.md' }]}
            mentionAgents={[{ kind: 'agent', id: 'agent-travel', name: 'Travel planner', slug: 'travel', picture: { image: null, emoji: null }, purpose: 'Plans trips' }]}
            searchMentionEntities={async () => ({ tasks: [{ kind: 'task', id: 'task-plan', title: 'Plan trip', status: 'todo' }], notes: [{ kind: 'note', id: 'note-ideas', title: 'Trip ideas' }], totals: { tasks: 1, notes: 1 } })}
            onSubmit={() => {
              sent.current.push(editor.current?.getMarkerOutput().text ?? '');
              editor.current?.clear();
            }}
          />
          <ComposerAddMenu
            editor={editor}
            skills={skills}
            mentions={<ComposerMentionRows editor={editor} agents />}
            onPick={(file) => setPicked((names) => [...names, file.name])}
          >
            <button type="button" role="menuitem">Extra row</button>
          </ComposerAddMenu>
        </main>
      </TipProvider>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
