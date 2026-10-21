/** Bundled independently for the opaque gallery iframe. Never imported by the app shell. */
import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { UiGallery, type GalleryPage } from '@ri/app-kit/ui';
import { TipProvider } from '@/components/ui/tip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmailComposer } from '@/components/chat-ui/email/email-composer';
import { PendingInputArea } from '@/components/chat-ui/pending-input-area';
import { IntegrationApprovalCard } from '@/components/chat-ui/approvals/integration-approval-card';
import { ConnectionRequestCard } from '@/components/chat-ui/approvals/connection-request-card';
import { MessageEntityChip } from '@/components/chat-ui/references/message-entity-chip';
import { SourceChip, SourceMetadataProvider } from '@/components/chat-ui/references/source-chip';
import { parseSourceMarkers } from '@/lib/chat-sources/reference';
import { MessageFileChip } from '@/components/chat-ui/artifacts/message-file-chip';
import { ArtifactPreviewProvider } from '@/components/chat-ui/artifacts/artifact-preview-provider';
import { HtmlPreviewLink } from '@/components/chat-ui/artifacts/html-preview-link';
import { EntityEditChip } from '@/components/chat-ui/edits/entity-edit-chip';
import { ResultRenderer } from '@/components/chat-ui/handoffs/result-renderer';
import { ExecutionEvent } from '@/components/chat-ui/activity/execution-event';
import { ConnectedView } from '@/components/mcp-apps/view';
import { ConnectedCompanion } from '@/components/mcp-apps/companion';
import { AppContextStrip, type AppContextGroupView } from '@/components/chat-ui/references/app-context-strip';
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
  const lookup = { tasksById: new Map(config.state === 'missing' ? [] : [[RECORD_ID, { id: RECORD_ID, title: 'Prepare the Friday review', status: 'todo' }]]), notesById: new Map([[RECORD_ID, { id: RECORD_ID, title: 'Project review notes' }]]), scratchpad: 'Alex prefers a short video call.\n\nKeep the agenda focused on decisions.' };
  return <div className="space-y-5 text-sm leading-8">
    <p>The next step is <MessageEntityChip marker={{ kind: 'task', id: RECORD_ID }} lookup={lookup} onOpen={() => setOpened('Prepare the Friday review')} />.</p>
    <p>I kept the context in <MessageEntityChip marker={{ kind: 'note', id: RECORD_ID }} lookup={lookup} onOpen={() => setOpened('Project review notes')} />.</p>
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

/** A composer with two apps' context, removable. */
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

function Example() {
  const revision = useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
  const example = galleryExample(__GALLERY_EXAMPLE__);
  return <div className={__GALLERY_EXAMPLE__ === 'app-kit' ? '' : 'mx-auto max-w-3xl p-4 sm:p-6'} data-gallery-example={__GALLERY_EXAMPLE__} data-gallery-state={config.state}>
    {__GALLERY_EXAMPLE__ !== 'app-kit' && <p className="mb-5 text-xs leading-relaxed text-muted-foreground">{example.tryThis}</p>}
    {__GALLERY_EXAMPLE__ === 'email' && <EmailComposer id={DRAFT_ID} sessionId={CHAT_ID} initial={runtime.email} />}
    {(__GALLERY_EXAMPLE__ === 'questions' || __GALLERY_EXAMPLE__ === 'permissions') && <PendingInputArea sessionId={CHAT_ID} />}
    {__GALLERY_EXAMPLE__ === 'approvals' && <IntegrationApprovalCard rows={runtime.events.filter(row => row.source === 'approval_request')} sessionId={CHAT_ID} isLatest />}
    {__GALLERY_EXAMPLE__ === 'connections' && <ConnectionRequestCard event={runtime.events[0]} sessionId={CHAT_ID} />}
    {__GALLERY_EXAMPLE__ === 'mentions' && <Mentions />}
    {__GALLERY_EXAMPLE__ === 'references' && <References />}
    {__GALLERY_EXAMPLE__ === 'chat-messages' && <ChatMessages />}
    {__GALLERY_EXAMPLE__ === 'app-context' && <AppContext />}
    {__GALLERY_EXAMPLE__ === 'edits' && <div className="space-y-4 text-sm"><p>I clarified the agenda and made the next steps easier to scan.</p><EntityEditChip entityType="note" entityId={RECORD_ID} /></div>}
    {__GALLERY_EXAMPLE__ === 'files' && <div className="space-y-5 text-sm"><p>Here are the review materials:</p><MessageFileChip attachment={{ fileName: 'gallery-agenda.txt', originalName: 'friday-agenda.txt', mimeType: 'text/plain', size: 99, uploadedAt: NOW }} variant="block" /><MessageFileChip attachment={{ fileName: 'gallery-image.svg', originalName: 'a-little-room-to-think.svg', mimeType: 'image/svg+xml', size: 720, uploadedAt: NOW }} fileUrl={() => IMAGE_URL} variant="block" /><MessageFileChip attachment={{ fileName: 'gallery-report.pdf', originalName: 'friday-review.pdf', mimeType: 'application/pdf', size: 48210, uploadedAt: NOW }} variant="block" /></div>}
    {__GALLERY_EXAMPLE__ === 'html' && <HtmlPreviewLink sessionId={CHAT_ID} path="review-plan.html">An interactive plan for the Friday review</HtmlPreviewLink>}
    {__GALLERY_EXAMPLE__ === 'handoffs' && <ResultRenderer resultId={RECORD_ID} />}
    {__GALLERY_EXAMPLE__ === 'activity' && <div className="space-y-5"><ExecutionEvent event={event('tool_call', { toolName: 'Bash', toolInput: { command: 'pnpm test --filter=calendar' } })} /><ExecutionEvent event={event('tool_result', { content: config.state === 'error' ? 'The calendar test failed. Friday overlaps with the existing review.' : 'All 12 calendar tests passed.', toolIsError: config.state === 'error' })} /><ExecutionEvent event={event(config.state === 'error' ? 'error' : 'agent', { content: config.state === 'error' ? 'The schedule needs one more adjustment.' : 'The review plan is ready.' })} handoffActions={false} /></div>}
    {__GALLERY_EXAMPLE__ === 'connected-app' && <div className="h-[580px]"><ConnectedCompanion chatId={CHAT_ID}>{() => <div className="p-2"><p className="text-sm text-muted-foreground">The estimate is $960 for eight hours. Try changing the hours in the app.</p><ConnectedView captureId={DRAFT_ID} chatId={CHAT_ID} /></div>}</ConnectedCompanion></div>}
    {__GALLERY_EXAMPLE__ === 'app-kit' && <UiGallery initialPage={config.state as GalleryPage} />}
    {runtime.logs.length > 0 && <div className="mt-6 space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground" aria-live="polite" key={`log-${revision}`}><p className="font-medium text-foreground">In this example</p>{runtime.logs.map((line, index) => <p key={index}>{line}</p>)}</div>}
  </div>;
}

const root = document.getElementById('root')!;
createRoot(root).render(<QueryClientProvider client={client}><ThemeProvider attribute="class" forcedTheme={config.theme} enableSystem={false}><TipProvider><ArtifactPreviewProvider><Example /></ArtifactPreviewProvider></TipProvider></ThemeProvider></QueryClientProvider>);
const reportHeight = () => parent.postMessage({ type: 'ri-chat-gallery-height', height: Math.max(300, root.scrollHeight + 16) }, '*');
new ResizeObserver(reportHeight).observe(root);
requestAnimationFrame(reportHeight);
