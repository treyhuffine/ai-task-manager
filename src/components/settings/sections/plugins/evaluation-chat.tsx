'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MessageCircle, Send, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageResponse } from '@/components/ai-elements/message';
import { trpc } from '@/lib/trpc/client';
import { evaluationContextSchema, type EvaluationContext } from '@/lib/plugins/evaluation-contract';

type Message = { role: 'user' | 'assistant'; text: string; turnId: string; status?: string };
type Conversation = { draft: string; messages: Message[]; contextId: string | null; allowChanges: boolean };
function emptyChat(): Conversation { return { draft: '', messages: [], contextId: null, allowChanges: false }; }
function viewName(context: EvaluationContext) { return 'inputs' in context ? 'Scenario Modeler' : `${context.app} · ${context.view}`; }

export function EvaluationChat({ viewUrl, frame }: { viewUrl: string; frame: RefObject<HTMLIFrameElement | null> }) {
  const send = useMutation(trpc.pluginEvaluation.chat.mutationOptions({ meta: { carriesInput: true } }));
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [chats, setChats] = useState<Conversation[]>([emptyChat(), emptyChat()]);
  const [contexts, setContexts] = useState<Record<string, EvaluationContext>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contextRef = useRef(contexts);
  const chatsRef = useRef(chats);
  const [latest, setLatest] = useState<string | null>(null);
  const everOpened = useRef(false);
  const selectedRef = useRef(selected);
  const log = useRef<HTMLDivElement>(null);
  const pending = useRef<{ turnId: string; invocationId: string; index: number; timer: number } | null>(null);
  useEffect(() => { chatsRef.current = chats; }, [chats]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const patch = useCallback((index: number, update: (chat: Conversation) => Conversation) => {
    setChats(previous => previous.map((chat, i) => i === index ? update(chat) : chat));
  }, []);
  const toolStatus = useCallback((index: number, turnId: string, status: string) => {
    patch(index, chat => ({ ...chat, messages: chat.messages.map(message => message.turnId === turnId && message.role === 'assistant' ? { ...message, status } : message) }));
  }, [patch]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== new URL(viewUrl).origin) return;
      const message = event.data;
      if (message?.kind === 'ri-evaluation-context') {
        const parsed = evaluationContextSchema.safeParse(message.context);
        if (!parsed.success) return;
        const next = parsed.data;
        if (!contextRef.current[next.invocationId] && Object.keys(contextRef.current).length >= 4) return;
        if (contextRef.current[next.invocationId]?.revision > next.revision) return;
        contextRef.current = { ...contextRef.current, [next.invocationId]: next };
        setLatest(next.invocationId);
        setContexts(contextRef.current);
      } else if (message?.kind === 'ri-evaluation-message' && typeof message.text === 'string' && message.text.length <= 2000 && typeof message.invocationId === 'string') {
        const index = selectedRef.current;
        const context = contextRef.current[message.invocationId];
        if (context && chatsRef.current[index].contextId === message.invocationId) {
          const attributed = `[${viewName(context)}] ${message.text}`;
          const fits = [chatsRef.current[index].draft, attributed].filter(Boolean).join('\n\n').length <= 2000;
          if (fits) patch(index, chat => {
            const draft = [chat.draft, attributed].filter(Boolean).join('\n\n');
            return draft.length <= 2000 ? { ...chat, draft } : chat;
          });
          setError(fits ? null : 'This app message does not fit in the draft. Your typing was preserved.');
          setOpen(true);
        }
      } else if (message?.kind === 'ri-evaluation-context-closed' && typeof message.invocationId === 'string') {
        const next = { ...contextRef.current }; delete next[message.invocationId];
        contextRef.current = next; setContexts(next);
        setLatest(previous => previous === message.invocationId ? null : previous);
      } else {
        const applying = pending.current;
        if (applying && ['ri-evaluation-applied', 'ri-evaluation-apply-failed'].includes(message?.kind) && applying.turnId === message.turnId && applying.invocationId === message.invocationId) {
          window.clearTimeout(applying.timer);
          toolStatus(applying.index, message.turnId, message.kind === 'ri-evaluation-applied' ? 'Applied to this scenario through MCP' : 'Calculated, but the view could not apply the result');
          pending.current = null; setBusy(false);
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); if (pending.current) window.clearTimeout(pending.current.timer); };
  }, [frame, viewUrl, toolStatus, patch]);

  function show() {
    if (!everOpened.current && latest) patch(0, chat => ({ ...chat, contextId: latest }));
    everOpened.current = true;
    setOpen(previous => !previous);
  }

  async function submit() {
    const index = selected;
    const conversation = chatsRef.current[index];
    const context = conversation.contextId ? contextRef.current[conversation.contextId] : undefined;
    const text = conversation.draft.trim();
    if (!text || !context || busy) return;
    const turnId = crypto.randomUUID();
    setBusy(true); setError(null);
    patch(index, chat => ({ ...chat, draft: '', messages: [...chat.messages, { role: 'user' as const, text, turnId }].slice(-24) }));
    try {
      const result = await send.mutateAsync({
        parentOrigin: window.location.origin, viewUrl, turnId, message: text,
        context, allowChanges: 'inputs' in context && conversation.allowChanges,
        history: conversation.messages.slice(-12).map(({ role, text }) => ({ role, text })),
      });
      let status = 'kind' in context ? 'Read the attached third-party context. No new server call.' : result.tool.status === 'ready' ? 'Read the sample data through MCP' : result.tool.status === 'unknown' ? 'Tool outcome unknown. No call was repeated.' : 'No server tool was called';
      const changed = 'inputs' in context && result.tool.inputs && Object.keys(context.inputs).some(key => context.inputs[key as keyof typeof context.inputs] !== result.tool.inputs![key as keyof typeof context.inputs]);
      const current = contextRef.current[context.invocationId];
      const canApply = changed && conversation.allowChanges && chatsRef.current[index].allowChanges && chatsRef.current[index].contextId === context.invocationId && current?.revision === context.revision && frame.current?.src === viewUrl;
      if (changed && !canApply) status = 'The scenario or its access changed. The result was not applied.';
      if (canApply) status = 'Applying the captured MCP result…';
      patch(index, chat => ({ ...chat, messages: [...chat.messages, { role: 'assistant' as const, text: result.text, turnId, status }].slice(-24) }));
      if (canApply) {
        const timer = window.setTimeout(() => {
          toolStatus(index, turnId, 'Calculated, but the view did not acknowledge the result');
          pending.current = null; setBusy(false);
        }, 15000);
        pending.current = { turnId, invocationId: context.invocationId, index, timer };
        frame.current!.contentWindow?.postMessage({ kind: 'ri-evaluation-tool-result', invocationId: context.invocationId, revision: context.revision, turnId }, new URL(viewUrl).origin);
      } else setBusy(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The sample chat could not finish.');
      patch(index, chat => ({ ...chat, draft: chat.draft || text }));
      setBusy(false);
    }
  }

  const chat = chats[selected];
  const context = chat.contextId ? contexts[chat.contextId] : undefined;
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [open, selected, chat.messages, busy]);
  return (
    <div className="absolute bottom-4 right-4 z-10 flex max-w-[calc(100vw-3rem)] flex-col items-end gap-2">
      {open && <section aria-label="Temporary demo chat" className="flex max-h-[72dvh] w-96 max-w-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div><p className="text-sm font-medium">Demo chat</p><p className="text-xs text-muted-foreground">Discuss the context you attach. Reload ends the chat.</p></div>
          <Button size="icon" variant="ghost" aria-label="Close demo chat" onClick={() => setOpen(false)}><X className="size-4" /></Button>
        </div>
        <div className="flex gap-2 px-4 pt-3">
          {[0, 1].map(index => <Button key={index} size="sm" variant={selected === index ? 'secondary' : 'ghost'} aria-pressed={selected === index} onClick={() => { setSelected(index); setError(null); }}>Chat {index + 1}</Button>)}
        </div>
        <div className="space-y-2 px-4 py-3">
          {chat.contextId ? <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-xs">
            <span><Tag className="mr-1 inline size-3" />{context ? viewName(context) + ('inputs' in context ? ` · Growth ${context.inputs.monthlyGrowthRate}%` : '') : 'Attached result · View closed'}</span>
            <Button size="icon" variant="ghost" className="size-6" aria-label={context && 'kind' in context ? 'Remove result context' : 'Remove scenario context'} onClick={() => patch(selected, value => ({ ...value, contextId: null }))}><X className="size-3" /></Button>
          </div> : Object.keys(contexts).length > 1 ? <div className="flex flex-wrap gap-1">{Object.values(contexts).map(value => <Button key={value.invocationId} variant="outline" size="sm" onClick={() => patch(selected, chat => ({ ...chat, contextId: value.invocationId }))}><Tag className="size-3" />Attach {viewName(value)}</Button>)}</div> : <Button variant="outline" size="sm" disabled={!latest} onClick={() => patch(selected, value => ({ ...value, contextId: latest }))}><Tag className="size-3" />{latest && contexts[latest] && 'kind' in contexts[latest] ? 'Attach result' : 'Attach scenario'}</Button>}
          {context && 'kind' in context ? <p className="text-xs text-muted-foreground">Read only. The agent can discuss this result, but cannot change this app or its records.</p> : <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={chat.allowChanges} onChange={event => patch(selected, value => ({ ...value, allowChanges: event.target.checked }))} />Allow updates to the sample scenario</label>}
        </div>
        <div ref={log} role="log" aria-label={`Demo chat ${selected + 1} messages`} className="min-h-20 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
          {!chat.messages.length && <p className="text-xs text-muted-foreground">{context ? 'inputs' in context ? 'Ask about the current sliders. Try “What growth rate do you see?”' : 'Ask about the displayed data or the latest information shared by this app.' : 'Open an example and attach its context here.'}</p>}
          {chat.messages.map((message, index) => <div key={index} className={message.role === 'user' ? 'ml-6 rounded-lg bg-muted px-3 py-2' : 'mr-2 px-1 py-1'}>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">{message.role === 'user' ? 'You' : 'Agent'}</p>
            {message.role === 'assistant' ? <MessageResponse mode="static" className="break-words text-xs">{message.text}</MessageResponse> : <p className="whitespace-pre-wrap break-words text-xs">{message.text}</p>}
            {message.status && <p role="status" className="mt-2 text-[10px] text-muted-foreground">{message.status}</p>}
          </div>)}
          {busy && <p role="status" className="text-xs text-muted-foreground">Reading the attached example…</p>}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <form className="flex items-end gap-2 border-t border-border p-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <textarea aria-label="Message the demo agent" rows={2} maxLength={2000} value={chat.draft} onChange={event => patch(selected, value => ({ ...value, draft: event.target.value }))} placeholder="Ask about this result…" className="min-w-0 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <Button type="submit" size="icon" disabled={busy || !context || !chat.draft.trim()} aria-label="Send demo message"><Send className="size-4" /></Button>
        </form>
      </section>}
      <Button size="sm" onClick={show} aria-expanded={open}><MessageCircle className="size-4" />{open ? 'Hide demo chat' : latest && contexts[latest] && 'kind' in contexts[latest] ? 'Chat about result' : 'Chat about scenario'}</Button>
    </div>
  );
}
