/** Bundled independently for the opaque gallery iframe. Never imported by the app shell. */
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { UiGallery, type GalleryPage } from '@ri/app-kit/ui';
import { Tip, TipProvider } from '@/components/ui/tip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CoordinationControls } from '@/components/chat-ui/coordination/controls';
import { ChatMenu } from '@/components/chat-ui/chat-menu';
import { CoordinationApproval } from '@/components/chat-ui/coordination/approval-card';
import { EmailComposer } from '@/components/chat-ui/email/email-composer';
import { PendingInputArea } from '@/components/chat-ui/pending-input-area';
import { IntegrationApprovalCard } from '@/components/chat-ui/approvals/integration-approval-card';
import { ConnectionRequestCard } from '@/components/chat-ui/approvals/connection-request-card';
import { MessageEntityChip } from '@/components/chat-ui/references/message-entity-chip';
import { SourceChip, SourceMetadataProvider } from '@/components/chat-ui/references/source-chip';
import { parseSourceMarkers } from '@/lib/chat-sources/reference';
import { MessageFileChip } from '@/components/chat-ui/artifacts/message-file-chip';
import { ArtifactPreviewProvider, useBesidePreview, useBesideRegion } from '@/components/chat-ui/artifacts/artifact-preview-provider';
import { PREVIEW_HOST_ATTRIBUTE } from '@/components/chat-ui/artifacts/artifact-preview-store';
import { BesideFileTab, BesideFileView } from '@/components/chat-ui/artifacts/artifact-beside';
import { HtmlPreviewLink } from '@/components/chat-ui/artifacts/html-preview-link';
import { EntityEditChip } from '@/components/chat-ui/edits/entity-edit-chip';
import { ResultRenderer } from '@/components/chat-ui/handoffs/result-renderer';
import { ExecutionEvent } from '@/components/chat-ui/activity/execution-event';
import { ChatTranscript } from '@/components/chat-ui/chat-transcript';
import { ChatCapabilities } from '@/components/chat-ui/chat-capabilities';
import { ChatComposer } from '@/components/chat-ui/chat-composer';
import { ModelMenuContent, ModelMenuLabel } from '@/components/chat-ui/model-menu/model-menu';
import { ModelMenuProvider } from '@/components/chat-ui/model-menu/model-menu-provider';
import { ChatInputEditor, type ChatInputEditorHandle } from '@/components/chat/editor/chat-input-editor';
import { MCP_FORM_EVENT, MCP_FORM_RESPONSE_EVENT } from '@/lib/mcp-apps/form-events';
import { toChatEventDTO } from '@/lib/api/dto/chat-event';
import { AgentResponse } from '@/components/chat-ui/messages/agent-response';
import { ConnectedView } from '@/components/mcp-apps/view';
import { ConnectedCompanion } from '@/components/mcp-apps/companion';
import { AppContextStrip, type AppContextGroupView } from '@/components/chat-ui/references/app-context-strip';
import { ModelMenuPreview } from './model-menu-preview';
import { galleryExample, type ChatUiExampleId } from './catalog';

declare const __GALLERY_EXAMPLE__: ChatUiExampleId;
import { CHAT_ID, DRAFT_ID, event, IMAGE_URL, mentionExample, NOW, PDF_PAGES, RECORD_ID, chatMessageExample } from './fixtures';
import { fixtureConfig as config, fixtureQueryClient as client, fixtureRuntime as runtime } from './fixture-client';

document.documentElement.classList.toggle('dark', config.theme === 'dark');
document.documentElement.dataset.theme = config.theme;

// Native components expect browser storage. Give this opaque document its
// own disposable maps, with no connection to the viewer's real storage.
for (const name of ['localStorage', 'sessionStorage']) {
  const values = new Map<string, string>();
  Object.defineProperty(window, name, { configurable: true, value: { get length() { return values.size; }, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, String(value)); }, removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear(), key: (index: number) => [...values.keys()][index] ?? null } });
}

// No fallback to the browser's real fetch. tRPC uses the memory link, and
// attachment previews can only read this explicitly named fictional file.
window.fetch = async input => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
  if (url.pathname === '/api/attachments/gallery-agenda.txt') return new Response('Friday review\n\n1. Look at the new dashboard\n2. Decide what ships next\n3. Assign the follow-ups', { headers: { 'content-type': 'text/plain' } });
  // The PDF's thumbnail and pages, as the Home draws them. A sandboxed page
  // can't host the browser's PDF viewer, so the preview shows these pages.
  const pdfPage = url.pathname === '/api/attachments/gallery-report.pdf' ? (url.searchParams.get('thumbnail') === '1' ? 1 : Number(url.searchParams.get('page'))) : 0;
  if (PDF_PAGES[pdfPage - 1]) return new Response(PDF_PAGES[pdfPage - 1], { headers: { 'content-type': 'image/svg+xml', 'x-pdf-pages': String(PDF_PAGES.length) } });
  throw new Error(`The gallery blocked a network request to ${url.pathname}`);
};
document.addEventListener('click', event => {
  const anchor = (event.target as Element).closest?.('a');
  if (anchor && !anchor.getAttribute('href')?.startsWith('#')) event.preventDefault();
}, true);

runtime.subscribe(() => { void client.invalidateQueries({ refetchType: 'active' }); });

function References() {
  const [opened, setOpened] = useState<string | null>(null);
  const lookup = { tasksById: new Map(config.state === 'missing' ? [] : [[RECORD_ID, { id: RECORD_ID, title: 'Prepare the Friday review', status: 'todo' }]]), notesById: new Map([[RECORD_ID, { id: RECORD_ID, title: 'Project review notes' }]]), agentsById: new Map(config.state === 'missing' ? [] : [[RECORD_ID, { id: RECORD_ID, name: 'Research', emoji: '🔎', attachments: [], areaId: null, purpose: 'Finds and summarizes sources for the review.', status: 'active' as const }]]), scratchpad: 'Alex prefers a short video call.\n\nKeep the agenda focused on decisions.' };
  return <div className="space-y-5 text-sm leading-8">
    <p>The next step is <MessageEntityChip marker={{ kind: 'task', id: RECORD_ID }} lookup={lookup} onOpen={() => setOpened('Prepare the Friday review')} />.</p>
    <p>I kept the context in <MessageEntityChip marker={{ kind: 'note', id: RECORD_ID }} lookup={lookup} onOpen={() => setOpened('Project review notes')} />.</p>
    <p>I asked <MessageEntityChip marker={{ kind: 'agent', id: RECORD_ID }} lookup={lookup} /> for the sources.</p>
    <p><MessageEntityChip marker={{ kind: 'scratchpad' }} lookup={lookup} onOpen={() => setOpened('Scratchpad')} /></p>
    <Dialog open={!!opened} onOpenChange={open => { if (!open) setOpened(null); }}><DialogContent><DialogHeader><DialogTitle>{opened}</DialogTitle></DialogHeader><p className="whitespace-pre-wrap text-sm text-muted-foreground">{opened === 'Scratchpad' ? lookup.scratchpad : 'This is a fictional record. In your chat, this reference opens the corresponding task or note.'}</p></DialogContent></Dialog>
  </div>;
}

/** The composer's chips (removable, in the page's colors) and the same message once sent, through the real transcript. */
function Mentions() {
  const { message, sources } = mentionExample(config.state);
  const [removed, setRemoved] = useState<string[]>([]);
  const segments = parseSourceMarkers(message);
  return <div className="space-y-6 text-sm">
    <section aria-label="Composer"><p className="mb-2 text-xs text-muted-foreground">In the composer</p>
      <div className="rounded-2xl border border-border bg-background px-4 py-3 text-[12.5px] leading-7">
        <SourceMetadataProvider chatId={CHAT_ID} refs={sources.map(source => source.sourceRef)}>
          {segments.map((segment, index) => segment.type === 'text' ? <span key={index}>{segment.text}</span>
            : removed.includes(segment.encoded) ? null : <SourceChip key={index} sourceRef={segment.encoded} onRemove={() => setRemoved(current => [...current, segment.encoded])} />)}
        </SourceMetadataProvider>
      </div>
    </section>
    <section aria-label="Sent message"><p className="mb-2 text-xs text-muted-foreground">Once sent</p>
      <ExecutionEvent event={event('user', { id: 'mention-message', role: 'user', content: message })} sessionId={CHAT_ID} handoffActions={false} />
    </section>
  </div>;
}

function SharedConversation() {
  const editor = useRef<ChatInputEditorHandle | null>(null);
  const [hasContent, setHasContent] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [model, setModel] = useState('example-balanced');
  const [events, setEvents] = useState(() => [
    event('user', { id: 'shared-maya', role: 'user', authorMemberId: 'maya', content: 'What is ready for the Friday review?' }),
    event('tool_call', { id: 'shared-read', toolName: 'mcp__ri_team__list_tasks', toolInput: { status: 'todo', limit: 20 } }),
    event('agent', { id: 'shared-answer', content: 'The dashboard is ready. The release note still needs a reviewer.' }),
    event('user', { id: 'shared-sam', role: 'user', authorMemberId: 'sam', content: 'I can review the release note.' }),
    event('agent', { id: 'shared-finish', content: 'I recorded that next step on the shared task.' }),
  ].map(toChatEventDTO));
  const off = config.state === 'off';
  const models = [{ id: 'example-balanced', label: 'Balanced example' }, { id: 'example-fast', label: 'Fast example' }];
  const send = () => {
    const text = editor.current?.getMarkerOutput().text.trim();
    if (!text || off) return;
    setEvents(current => [...current, toChatEventDTO(event('user', { id: `shared-maya-${current.length}`, role: 'user', authorMemberId: 'maya', content: text }))]);
    editor.current?.clear();
  };
  return <ChatCapabilities.Provider value={{ deliveryReceipts: false, prepareResults: false }}>
    <div className="flex h-[460px] flex-col rounded-xl border border-border">
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">Everyone in Acme can read this chat.{config.state === 'off' ? ' AI is off. Saved history remains readable.' : ''}</p>
      <ChatTranscript session={{ id: CHAT_ID, startedAt: NOW }} events={events} isLoading={false} isRunning={false} hasOlder={false} isLoadingOlder={false} loadOlder={async () => 0} eventHeader={item => item.source === 'user' ? <p className="mb-1 text-xs font-semibold">{item.id.startsWith('shared-maya') ? 'Maya' : 'Sam'}</p> : null} />
      <ChatComposer disabled={off} status={off ? 'AI is off. Saved history stays readable.' : 'This example saves messages only in this preview.'}>
        <ChatInputEditor ref={editor} ariaLabel="Example shared message" placeholder="Write an example message" disabled={off} attachmentsEnabled={false} onContentChange={setHasContent} onSubmit={send} />
        <div className="flex items-center gap-2 px-1.5 pb-1.5">
          <Popover open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
            <PopoverTrigger asChild><Tip label="Choose an example model"><button type="button" disabled={off} aria-label={`Model and settings: ${models.find(option => option.id === model)!.label}`} className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"><ModelMenuLabel model={models.find(option => option.id === model)!.label} /></button></Tip></PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start"><ModelMenuContent disabled={off}>
              <ModelMenuProvider harness="claude" models={models} additionalModels={[]} selectedModel={model} disabled={off} onSelect={option => { setModel(option.id); setModelMenuOpen(false); }} />
            </ModelMenuContent></PopoverContent>
          </Popover>
          <button type="button" className="ml-auto rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50" onClick={send} disabled={off || !hasContent}>Send example</button>
        </div>
      </ChatComposer>
    </div>
  </ChatCapabilities.Provider>;
}

/** A composer with two apps' context, removable, and a message an app sent, through the real transcript. */
function AppContext() {
  const [groups, setGroups] = useState<AppContextGroupView[]>([
    { viewId: 'parts', app: 'Parts Library', items: [
      { kind: 'text', title: 'M6 hex bolt', text: 'Selected: M6 hex bolt, zinc plated, 30 mm' },
      { kind: 'link', title: 'M6 washer', uri: 'parts://library/washer' },
    ] },
    { viewId: 'board', app: 'Planning Board', items: [{ kind: 'text', text: 'Column: This week, 4 cards' }] },
  ]);
  return <section aria-label="Composer" className="rounded-xl border border-border bg-card">
    <AppContextStrip groups={groups} onRemove={viewId => setGroups(current => current.filter(group => group.viewId !== viewId))} />
    <p className="px-3 pb-3 pt-2 text-[13px] text-muted-foreground">Ask about the selected part</p>
  </section>;
}

function ServerForm() {
  const closed = config.state !== 'open';
  const events = [toChatEventDTO(event('system', { id: DRAFT_ID, role: 'system', content: MCP_FORM_EVENT }))];
  if (closed) events.push(toChatEventDTO(event('system', { id: 'form-outcome', role: 'system', content: MCP_FORM_RESPONSE_EVENT, raw: { app: 'Review Board', outcome: config.state } })));
  return <div className="flex h-[520px] flex-col rounded-xl border border-border"><ChatTranscript session={{ id: CHAT_ID, startedAt: NOW }} events={events} isLoading={false} isRunning={false} hasOlder={false} isLoadingOlder={false} loadOlder={async () => 0} /></div>;
}

function FileChips() {
  return <div className="space-y-5 text-sm"><p>Here are the review materials:</p><MessageFileChip attachment={{ fileName: 'gallery-agenda.txt', originalName: 'friday-agenda.txt', mimeType: 'text/plain', size: 99, uploadedAt: NOW }} variant="block" /><MessageFileChip attachment={{ fileName: 'gallery-image.svg', originalName: 'a-little-room-to-think.svg', mimeType: 'image/svg+xml', size: 720, uploadedAt: NOW }} fileUrl={() => IMAGE_URL} variant="block" /><MessageFileChip attachment={{ fileName: 'gallery-report.pdf', originalName: 'friday-review.pdf', mimeType: 'application/pdf', size: 48210, uploadedAt: NOW }} variant="block" /></div>;
}

/** A chat with a panel beside it, as Home's second panel or an execution's tools: its files open there as a tab. */
function FilesBeside({ children }: { children?: ReactNode } = {}) {
  const host = 'gallery';
  const [fileShown, setFileShown] = useState(false);
  const file = useBesidePreview(host);
  const shown = fileShown && !!file;
  useBesideRegion(host, { available: true, side: 'right', showing: shown, show: () => setFileShown(true) });
  return <div className="flex h-[580px] overflow-hidden rounded-lg border border-border">
    <div {...{ [PREVIEW_HOST_ATTRIBUTE]: host }} role="log" aria-label="Chat" className="min-w-0 flex-1 overflow-y-auto p-4">{children ?? <FileChips />}</div>
    <aside aria-label="Beside the chat" className="flex w-[55%] min-w-0 flex-col border-l border-border">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border">
        <button type="button" aria-pressed={!shown} onClick={() => setFileShown(false)} className={`border-b-2 px-3 text-[11px] font-medium ${shown ? 'border-transparent text-muted-foreground' : 'border-primary text-primary'}`}>Deck</button>
        <BesideFileTab host={host} active={shown} onSelect={() => setFileShown(true)} className={`border-b-2 px-3 text-[11px] font-medium ${shown ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`} />
      </div>
      <div className="relative min-h-0 flex-1">
        <div inert={shown} className="space-y-2 p-4 text-sm text-muted-foreground"><p className="font-medium text-foreground">Today</p><p>Prepare the Friday review</p><p>Reply to Alex about the agenda</p></div>
        {file && <div inert={!shown} className={`absolute inset-0 ${shown ? '' : 'pointer-events-none opacity-0'}`}><BesideFileView host={host} /></div>}
      </div>
    </aside>
  </div>;
}

function ChatMessages() {
  const { received, sent } = chatMessageExample(config.state);
  return <div className="space-y-7">
    <section aria-label="Receiving chat" className="space-y-3">
      <p className="text-xs text-muted-foreground">In the receiving chat</p>
      <ExecutionEvent event={received} handoffActions={false} />
      <p className="text-[12.5px] leading-relaxed">{config.state === 'reply' ? 'I’ll include these findings in the handoff.' : 'I’ll check the boundary cases and report back with the results.'}</p>
    </section>
    <section aria-label="Sending chat" className="space-y-3">
      <p className="text-xs text-muted-foreground">In the sending chat</p>
      <p className="text-[12.5px] leading-relaxed">{config.state === 'reply' ? 'The review is complete. I’m sending the findings back.' : 'I’m asking the date handling chat to review this before the handoff.'}</p>
      <ExecutionEvent event={sent} handoffActions={false} />
    </section>
  </div>;
}

function TextFiles() {
  const links = <AgentResponse sessionId={CHAT_ID} text={config.state === 'errors'
    ? 'Open [the missing file](missing.md), [a large file](large.md), or [a binary file](binary.txt).'
    : 'Read [the review document](friday-review.md) or inspect [the example source](example.ts).'} />;
  return config.state === 'beside' ? <FilesBeside>{links}</FilesBeside> : <section role="log" aria-label="Chat">{links}</section>;
}

function RichFiles() {
  const text = config.state === 'media' ? 'Play [the demo](demo.webm), listen to [the voice memo](memo.wav), or try [an unsupported clip](broken.mov).'
    : config.state === 'office' ? 'Read [the document](review.docx) or [the slide content](review.pptx).'
      : config.state === 'archives' ? 'Inspect [the ZIP archive](files.zip) or [the TAR archive](files.tgz).'
        : config.state === 'fallback' ? 'Open [the generated file](output.bin).'
          : 'Browse [the workbook](budget.xlsx) or [the CSV](data.csv).';
  const links = <AgentResponse sessionId={CHAT_ID} text={text} />;
  return config.state === 'beside' ? <FilesBeside>{links}</FilesBeside> : <section role="log" aria-label="Chat">{links}</section>;
}

/** Keep status in the real composer card, so the preview covers its placement. */
function CoordinationComposer() {
  const editor = useRef<ChatInputEditorHandle | null>(null);
  const [hasContent, setHasContent] = useState(false);
  const send = () => {
    const content = editor.current?.getMarkerOutput().text.trim();
    if (!content) return;
    void runtime.invoke('sessions.messagesPost', { body: { content } });
    editor.current?.clear();
  };
  return <ChatComposer hint="⇧⇥ to cycle modes">
    <CoordinationControls sessionId={CHAT_ID} />
    <ChatInputEditor ref={editor} ariaLabel="Example message" placeholder="Message your agent" attachmentsEnabled={false} onContentChange={setHasContent} onSubmit={send} />
    <div className="flex justify-end px-2 pb-2"><button type="button" onClick={send} disabled={!hasContent} className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">Send example</button></div>
  </ChatComposer>;
}

function Example() {
  const revision = useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
  const example = galleryExample(__GALLERY_EXAMPLE__);
  const wide = (__GALLERY_EXAMPLE__ === 'files' || __GALLERY_EXAMPLE__ === 'text-files' || __GALLERY_EXAMPLE__ === 'file-previews') && config.state === 'beside';
  return <div className={__GALLERY_EXAMPLE__ === 'app-kit' ? '' : wide ? 'p-4 sm:p-6' : 'mx-auto max-w-3xl p-4 sm:p-6'} data-gallery-example={__GALLERY_EXAMPLE__} data-gallery-state={config.state}>
    {__GALLERY_EXAMPLE__ !== 'app-kit' && <p className="mb-5 text-xs leading-relaxed text-muted-foreground">{example.tryThis}</p>}
    {__GALLERY_EXAMPLE__ === 'text-files' && <TextFiles />}
    {__GALLERY_EXAMPLE__ === 'file-previews' && <RichFiles />}
    {__GALLERY_EXAMPLE__ === 'links' && <AgentResponse text={config.state === 'paths'
      ? 'Review [the notes](./notes/review.md), [the source](/tmp/example/src/app.tsx), or [README](README.md).'
      : 'Read [the website](https://example.com/guide?view=review#next), visit https://example.com, or use [a longer destination](https://example.com/research/planning/a-longer-document-name?view=review&section=next-steps#decisions).'} />}
    {__GALLERY_EXAMPLE__ === 'email' && <EmailComposer id={DRAFT_ID} sessionId={CHAT_ID} initial={runtime.email} />}
    {(__GALLERY_EXAMPLE__ === 'questions' || __GALLERY_EXAMPLE__ === 'permissions') && <PendingInputArea sessionId={CHAT_ID} />}
    {__GALLERY_EXAMPLE__ === 'approvals' && <IntegrationApprovalCard rows={runtime.events.filter(row => row.source === 'approval_request')} sessionId={CHAT_ID} isLatest />}
    {__GALLERY_EXAMPLE__ === 'connections' && <ConnectionRequestCard event={runtime.events[0]} sessionId={CHAT_ID} />}
    {__GALLERY_EXAMPLE__ === 'mentions' && <Mentions />}
    {__GALLERY_EXAMPLE__ === 'shared-chat' && <SharedConversation />}
    {__GALLERY_EXAMPLE__ === 'references' && <References />}
    {__GALLERY_EXAMPLE__ === 'server-form' && <ServerForm />}
    {__GALLERY_EXAMPLE__ === 'chat-messages' && <ChatMessages />}
    {__GALLERY_EXAMPLE__ === 'coordination' && <div className="space-y-5"><div className="flex justify-end"><ChatMenu sessionId={CHAT_ID} /></div>{config.state === 'forward-failed' ? <ExecutionEvent sessionId={CHAT_ID} handoffActions={false} event={event('system', {role:'system',content:'coordination_send_failed',raw:{agentCoordination:{deliveryId:'gallery-coordination-send'}}})} /> : config.state === 'shared' ? <ExecutionEvent sessionId={CHAT_ID} handoffActions={false} event={event('user', {id:'gallery-shared',role:'user',content:'Full original review content.',raw:{agentCoordination:{senderKind:'human',kind:'message',sourceSessionId:CHAT_ID,sourceEventId:'gallery-original',content:'Full original review content.',directions:'Compare this with your implementation.'}}})} /> : config.state === 'unavailable' ? <ExecutionEvent sessionId={CHAT_ID} handoffActions={false} event={event('error', {role:'system',content:'[Ri routing text remains saved]',raw:{agentCoordination:{senderKind:'system',kind:'failed',content:'The destination agent is unavailable. The assigned work did not start.',originalRequest:'Review the date boundary handling before we ship.'}}})} /> : ['idle', 'active', 'finished', 'held'].includes(config.state) ? <p className="text-sm text-muted-foreground">{config.state === 'idle' ? 'An ordinary chat, ready for your next message.' : config.state === 'finished' ? 'The review is complete. Its linked messages remain in the transcript.' : config.state === 'held' ? 'Incoming messages are queued until you resume.' : 'The other chat is reviewing the date handling.'}</p> : <CoordinationApproval deliveryId="gallery-coordination-send" sessionId={CHAT_ID} />}<CoordinationComposer /></div>}
    {__GALLERY_EXAMPLE__ === 'app-context' && <AppContext />}
    {__GALLERY_EXAMPLE__ === 'model-menu' && <ModelMenuPreview state={config.state} />}
    {__GALLERY_EXAMPLE__ === 'edits' && <div className="space-y-4 text-sm"><p>I clarified the agenda and made the next steps easier to scan.</p><EntityEditChip entityType="note" entityId={RECORD_ID} /></div>}
    {__GALLERY_EXAMPLE__ === 'files' && (config.state === 'beside' ? <FilesBeside /> : <FileChips />)}
    {__GALLERY_EXAMPLE__ === 'html' && <HtmlPreviewLink sessionId={CHAT_ID} path="review-plan.html">An interactive plan for the Friday review</HtmlPreviewLink>}
    {__GALLERY_EXAMPLE__ === 'handoffs' && <ResultRenderer resultId={RECORD_ID} />}
    {__GALLERY_EXAMPLE__ === 'activity' && <div className="space-y-5"><ExecutionEvent event={event('tool_call', { toolName: 'Bash', toolInput: { command: 'pnpm test --filter=calendar' } })} /><ExecutionEvent event={event('tool_result', { content: config.state === 'error' ? 'The calendar test failed. Friday overlaps with the existing review.' : 'All 12 calendar tests passed.', toolIsError: config.state === 'error' })} /><ExecutionEvent event={event(config.state === 'error' ? 'error' : 'agent', { content: config.state === 'error' ? 'The schedule needs one more adjustment.' : 'The review plan is ready.' })} handoffActions={false} /></div>}
    {__GALLERY_EXAMPLE__ === 'connected-app' && <div className="h-[580px]"><ConnectedCompanion chatId={CHAT_ID}>{() => <div className="p-2"><p className="text-sm text-muted-foreground">The estimate is $960 for eight hours. Try changing the hours in the app.</p><ConnectedView captureId={DRAFT_ID} chatId={CHAT_ID} /></div>}</ConnectedCompanion></div>}
    {__GALLERY_EXAMPLE__ === 'app-kit' && <UiGallery initialPage={config.state as GalleryPage} />}
    {runtime.logs.length > 0 && <div className="mt-6 space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground" aria-live="polite" key={`log-${revision}`}><p className="font-medium text-foreground">In this example</p>{runtime.logs.map((line, index) => <p key={index}>{line}</p>)}</div>}
  </div>;
}

const root = document.getElementById('root')!;
createRoot(root).render(<QueryClientProvider client={client}><ThemeProvider attribute="class" forcedTheme={config.theme} enableSystem={false}><TipProvider><ArtifactPreviewProvider><ChatCapabilities.Provider value={{ deliveryReceipts: false, prepareResults: false }}><Example /></ChatCapabilities.Provider></ArtifactPreviewProvider></TipProvider></ThemeProvider></QueryClientProvider>);
