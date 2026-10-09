import React, { useRef, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatInputEditor, type ChatInputEditorHandle } from '@/components/chat/editor/chat-input-editor';
import { TooltipProvider } from '@/components/ui/tooltip';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
  const ref = useRef<ChatInputEditorHandle>(null);
  const [chat, setChat] = useState('01900111-1111-7111-8111-111111111111');
  useEffect(() => { Object.assign(window, { sourceEditor: ref, changeSourceChat: setChat }); }, []);
  return <QueryClientProvider client={client}><TooltipProvider><div style={{ margin: '220px 12px 0', width: 'calc(100% - 24px)' }}><ChatInputEditor ref={ref} sourceChatId={chat} draftKey={`test-source:${chat}`} mentionFiles={[{ kind: 'file', path: 'README.md', name: 'README.md' }]} searchMentionEntities={async () => ({ tasks: [{ kind: 'task', id: 'test-task', title: 'Plan trip', status: 'todo' }], notes: [], totals: { tasks: 1, notes: 0 } })} /></div></TooltipProvider></QueryClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
