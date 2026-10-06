'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MessageCircle, Send, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageResponse } from '@/components/ai-elements/message';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { allowsEvaluationChanges, evaluationContextSchema, type EvaluationContext } from '@/lib/plugins/evaluation-contract';

type Approval = { invocationId: string; revision: number; ticket: string; toolName: string; arguments: Record<string, unknown>; approvalIds: string[] };
type Message = { role: 'user' | 'assistant'; text: string; turnId: string; status?: string; approval?: Approval };
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
  const pending = useRef<{ turnId: string; invocationId: string; index: number; timer: number; label: string } | null>(null);
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
          toolStatus(applying.index, message.turnId, message.kind === 'ri-evaluation-applied' ? `Applied to this ${applying.label} through MCP` : 'The view could not apply the captured result. No call was repeated.');
          pending.current = null; setBusy(false);
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); if (pending.current) window.clearTimeout(pending.current.timer); };
  }, [frame, viewUrl, toolStatus, patch]);

  function show() {
    if (!everOpened.current && latest) patch(0, chat => ({ ...chat, contextId: latest, allowChanges: false }));
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
        context, allowChanges: allowsEvaluationChanges(context) && conversation.allowChanges,
        history: conversation.messages.slice(-12).map(({ role, text }) => ({ role, text })),
      });
      const diagram = !!result.tool.diagram && 'kind' in context && context.app === 'Excalidraw' && result.tool.diagram.invocationId === context.invocationId;
      const view = result.tool.view?.invocationId === context.invocationId;
      const label = 'inputs' in context ? 'scenario' : context.app === 'Excalidraw' ? 'diagram' : context.app === 'tldraw' ? 'canvas' : context.app === 'Flint charts' ? 'chart' : 'view';
      const approval = result.tool.status === 'approval' && result.tool.ticket && result.tool.toolName && result.tool.approvalIds?.length ? { invocationId: context.invocationId, revision: context.revision, ticket: result.tool.ticket, toolName: result.tool.toolName, arguments: result.tool.arguments ?? {}, approvalIds: result.tool.approvalIds } : undefined;
      let status = approval ? 'Review this account action before it runs.' : view ? 'Prepared a view result through MCP' : result.tool.status === 'unknown' ? 'Tool outcome unknown. No call was repeated.' : diagram ? 'Prepared a diagram revision through MCP' : 'kind' in context ? 'Read the attached third-party context. No new server call.' : result.tool.status === 'ready' ? 'Read the sample data through MCP' : 'No server tool was called';
      const changed = view || diagram || 'inputs' in context && result.tool.inputs && Object.keys(context.inputs).some(key => context.inputs[key as keyof typeof context.inputs] !== result.tool.inputs![key as keyof typeof context.inputs]);
      const current = contextRef.current[context.invocationId];
      const canApply = changed && conversation.allowChanges && chatsRef.current[index].allowChanges && chatsRef.current[index].contextId === context.invocationId && current?.revision === context.revision && frame.current?.src === viewUrl;
      if (changed && !canApply) status = `The ${label} or its access changed. The result was not applied.`;
      if (canApply) status = 'Applying the captured MCP result…';
      patch(index, chat => ({ ...chat, messages: [...chat.messages, { role: 'assistant' as const, text: result.text, turnId, status, approval }].slice(-24) }));
      if (canApply) {
        const timer = window.setTimeout(() => {
          toolStatus(index, turnId, 'Calculated, but the view did not acknowledge the result');
          pending.current = null; setBusy(false);
        }, 15000);
        pending.current = { turnId, invocationId: context.invocationId, index, timer, label };
        const capture = result.tool.ticket ? await trpcClient.pluginEvaluation.accountChatCapture.mutate({ ticket: result.tool.ticket }) : undefined;
        if (chatsRef.current[index].contextId !== context.invocationId || !chatsRef.current[index].allowChanges || contextRef.current[context.invocationId]?.revision !== context.revision) { window.clearTimeout(timer); pending.current = null; toolStatus(index, turnId, 'The view or its access changed. The captured result was not applied.'); setBusy(false); return; }
        frame.current!.contentWindow?.postMessage({ capture, kind: 'ri-evaluation-tool-result', invocationId: context.invocationId, revision: context.revision, turnId }, new URL(viewUrl).origin);
      } else setBusy(false);
    } catch (failure) {
      if (pending.current?.turnId === turnId) { window.clearTimeout(pending.current.timer); pending.current = null; }
      setError(failure instanceof Error ? failure.message : 'The sample chat could not finish.');
      patch(index, chat => ({ ...chat, draft: chat.draft || text }));
      setBusy(false);
    }
  }

  async function decide(index: number, message: Message, approve: boolean) {
    if (!message.approval || busy) return;
    const approval = message.approval;
    const conversation = chatsRef.current[index];
    const context = conversation.contextId ? contextRef.current[conversation.contextId] : undefined;
    if (approve && (!context || context.invocationId !== approval.invocationId || context.revision !== approval.revision || !conversation.allowChanges)) { setError('Attach the originating result and enable its updates before approving.'); return; }
    setBusy(true); setError(null);
    try {
      await trpcClient.connectors.approvePost.mutate({ body: { ids: approval.approvalIds, decision: approve ? 'approve' : 'deny' } });
      if (!approve) { patch(index, chat => ({ ...chat, messages: chat.messages.map(value => value.turnId === message.turnId ? { ...value, approval: undefined, status: 'Declined. No account tool was run.' } : value) })); setBusy(false); return; }
      const capture = await trpcClient.pluginEvaluation.accountChatCapture.mutate({ ticket: approval.ticket, retryApproval: true });
      patch(index, chat => ({ ...chat, messages: chat.messages.map(value => value.turnId === message.turnId ? { ...value, approval: undefined, status: 'Account call completed. Applying its captured result…' } : value) }));
      if (capture.invocationId !== context!.invocationId || chatsRef.current[index].contextId !== context!.invocationId || !chatsRef.current[index].allowChanges || contextRef.current[context!.invocationId]?.revision !== context!.revision || frame.current?.src !== viewUrl) { toolStatus(index, message.turnId, 'The account call completed, but the view or its access changed. Its result was not applied.'); setBusy(false); return; }
      const timer = window.setTimeout(() => { pending.current = null; toolStatus(index, message.turnId, 'The account call completed, but its view did not acknowledge the result.'); setBusy(false); }, 15000);
      pending.current = { turnId: message.turnId, invocationId: context!.invocationId, index, timer, label: 'view' };
      frame.current?.contentWindow?.postMessage({ kind: 'ri-evaluation-tool-result', capture, invocationId: context!.invocationId, revision: context!.revision, turnId: message.turnId }, new URL(viewUrl).origin);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The account action could not finish. No accepted call was repeated.'); setBusy(false); }
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
            <Button size="icon" variant="ghost" className="size-6" aria-label={context && 'kind' in context ? 'Remove result context' : 'Remove scenario context'} onClick={() => patch(selected, value => ({ ...value, contextId: null, allowChanges: false }))}><X className="size-3" /></Button>
          </div> : Object.keys(contexts).length > 1 ? <div className="flex flex-wrap gap-1">{Object.values(contexts).map(value => <Button key={value.invocationId} variant="outline" size="sm" onClick={() => patch(selected, chat => ({ ...chat, contextId: value.invocationId, allowChanges: false }))}><Tag className="size-3" />Attach {viewName(value)}</Button>)}</div> : <Button variant="outline" size="sm" disabled={!latest} onClick={() => patch(selected, value => ({ ...value, contextId: latest, allowChanges: false }))}><Tag className="size-3" />{latest && contexts[latest] && 'kind' in contexts[latest] ? 'Attach result' : 'Attach scenario'}</Button>}
          {context && !allowsEvaluationChanges(context) ? <p className="text-xs text-muted-foreground">Read only. The agent can discuss this result, but cannot change this app or its records.</p> : context && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={chat.allowChanges} onChange={event => patch(selected, value => ({ ...value, allowChanges: event.target.checked }))} />{'kind' in context ? context.app === 'Excalidraw' ? 'Allow updates to this diagram' : context.app === 'Flint charts' ? 'Allow updates to this chart' : context.app === 'tldraw' ? 'Allow updates to this canvas' : context.kind === 'account' ? 'Allow calls on this account' : 'Allow changes to this building view' : 'Allow updates to the sample scenario'}</label>}
        </div>
        <div ref={log} role="log" aria-label={`Demo chat ${selected + 1} messages`} className="min-h-20 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
          {!chat.messages.length && <p className="text-xs text-muted-foreground">{context ? 'inputs' in context ? 'Ask about the current sliders. Try “What growth rate do you see?”' : allowsEvaluationChanges(context) ? context.app === 'Excalidraw' ? 'Enable updates, then try “Add a green Done step after Execute.”' : context.app === 'Flint charts' ? 'Enable updates, then try “Change this to a line chart.”' : context.app === 'tldraw' ? 'Enable updates, then try “Add a green Done box.”' : context.app === 'Building explorer' ? 'Enable view changes, then try “Show Gustav Mahlerlaan 10 in a table.”' : 'Enable account calls, then ask the agent to revise this workflow. Account approvals still apply.' : 'Ask about the displayed data or the latest information shared by this app.' : 'Open an example and attach its context here.'}</p>}
          {chat.messages.map((message, index) => <div key={index} className={message.role === 'user' ? 'ml-6 rounded-lg bg-muted px-3 py-2' : 'mr-2 px-1 py-1'}>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">{message.role === 'user' ? 'You' : 'Agent'}</p>
            {message.role === 'assistant' ? <MessageResponse mode="static" className="break-words text-xs">{message.text}</MessageResponse> : <p className="whitespace-pre-wrap break-words text-xs">{message.text}</p>}
            {message.approval && <div className="mt-2 space-y-2 rounded-md border border-border p-2"><p className="text-xs font-medium">{message.approval.toolName}</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-[10px]">{JSON.stringify(message.approval.arguments, null, 2).slice(0, 4000)}</pre><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void decide(selected, message, true)}>Approve once</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void decide(selected, message, false)}>Decline</Button></div></div>}
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
