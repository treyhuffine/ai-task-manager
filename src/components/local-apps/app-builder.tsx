'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDefaultLayout, type Layout, type LayoutStorage } from 'react-resizable-panels';
import { Hammer, Loader2, MoreHorizontal, Play, ScrollText } from 'lucide-react';
import { HarnessChatSession } from '@/components/chat/harness-chat';
import type { MainChatIntro } from '@/components/chat/main-chat-intro';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useElementWidth } from '@/hooks/use-element-width';
import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
import { cn } from '@/lib/utils';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { AppHeader, IconAction, PrimaryAction, QuietAction } from './app-header';
import type { LocalAppDraft, LocalAppsList } from './app-hooks';
import { AppOutput } from './app-output';
import { AppToolSummary } from './app-tool-summary';
import { AppView } from './app-view';
import { buildStatus, draftTitle } from './app-copy';
import { useAppAction } from './use-app-action';

const CHAT_PANEL = 'app-builder-chat';
const PREVIEW_PANEL = 'app-builder-preview';
const DEFAULT_LAYOUT: Layout = { [CHAT_PANEL]: 42, [PREVIEW_PANEL]: 58 };
const NOOP_STORAGE: LayoutStorage = { getItem: () => null, setItem: () => {} };
const NARROW_WIDTH = 820;

type Pane = 'chat' | 'preview';
const PANES: ReadonlyArray<{ value: Pane; label: string }> = [
  { value: 'chat', label: 'Chat' },
  { value: 'preview', label: 'Preview' },
];

type ChatKind = 'build' | 'try';
const CHATS: ReadonlyArray<{ kind: ChatKind; entityType: 'app-builder' | 'app-try'; label: string; placeholder: string }> = [
  { kind: 'build', entityType: 'app-builder', label: 'Build', placeholder: 'Describe what this app should do' },
  { kind: 'try', entityType: 'app-try', label: 'Try it', placeholder: 'Try the app with sample records' },
];

/** The first thing the builder says, the skill builder's way: what to tell it, and a few ways in. */
function buildIntro(changing: boolean): MainChatIntro {
  return {
    title: changing ? 'What should change?' : 'What should this app do?',
    description:
      'Say it the way you would to a friend who builds things: what you want to keep track of, what you want to see, what should happen on its own. The builder writes the app, you build a preview and try it, and Use app makes it yours.',
    starters: changing
      ? [
          { label: 'Add a view', prompt: 'Add a view that shows ', draft: true },
          { label: 'Change how something works', prompt: 'Change how ', draft: true },
        ]
      : [
          { label: 'Track something', prompt: 'I want to keep track of ', draft: true },
          { label: 'A small calculator', prompt: 'I want a calculator for ', draft: true },
          { label: 'A list with a weekly review', prompt: 'A list of things I want to ', draft: true },
        ],
  };
}

const TRY_INTRO: MainChatIntro = {
  title: 'Try it the way you would use it',
  description:
    'This chat can use the preview and its sample records. Ask for something the app should handle and watch what happens. Nothing here touches the app you use.',
  starters: [{ label: 'Ask something it should handle', prompt: '', draft: true }],
};

function DraftMark() {
  return (
    <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <Hammer size={15} />
    </span>
  );
}

/**
 * The builder (docs/local-apps.md): the chat that writes the app with you on
 * the left, the preview on the right, the skill builder's shape. Build
 * preview compiles the draft into a preview with its own records. Try it is
 * a second chat that uses the preview, so you can see it work before Use
 * app makes it yours.
 */
export function AppBuilder({
  draft,
  data,
  navigate,
}: {
  draft: LocalAppDraft;
  data: LocalAppsList;
  navigate: (route: string) => void;
}) {
  const id = draft.id;
  const { busy, run } = useAppAction();
  const [kind, setKind] = useState<ChatKind>('build');
  const [visited, setVisited] = useState<Set<ChatKind>>(() => new Set(['build']));
  const [pane, setPane] = useState<Pane>('chat');
  const [showOutput, setShowOutput] = useState(false);
  const [measureRef, width] = useElementWidth<HTMLDivElement>();
  const narrow = width !== null && width < NARROW_WIDTH;

  const [storage] = useState<LayoutStorage>(() => (typeof window === 'undefined' ? NOOP_STORAGE : window.localStorage));
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'ri.app-builder.layout', storage });

  const building = draft.buildStatus === 'building';
  const validated = draft.buildStatus === 'validated';
  const status = buildStatus(draft);

  const chats = {
    build: useDraftChat(id, 'app-builder', visited.has('build')),
    try: useDraftChat(id, 'app-try', visited.has('try')),
  };

  const chat = (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Build or try" className="flex flex-shrink-0 items-center gap-0.5 border-b border-border/50 px-3 py-1">
        {CHATS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            role="tab"
            aria-selected={kind === entry.kind}
            onClick={() => {
              setKind(entry.kind);
              setVisited((prev) => (prev.has(entry.kind) ? prev : new Set(prev).add(entry.kind)));
            }}
            className={cn(
              'rounded-md px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.06em] transition-colors',
              kind === entry.kind ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {CHATS.filter((entry) => visited.has(entry.kind)).map((entry) => {
        const session = chats[entry.kind];
        return (
          <div
            key={entry.kind}
            inert={kind !== entry.kind}
            className={cn('min-h-0 flex-1 flex-col', kind === entry.kind ? 'flex' : 'hidden')}
          >
            {session.id ? (
              <HarnessChatSession
                key={session.id}
                sessionId={session.id}
                autoFocusComposer={kind === entry.kind}
                composerPlaceholder={entry.placeholder}
                intro={entry.kind === 'build' ? buildIntro(!!draft.sourceInstanceId) : TRY_INTRO}
              />
            ) : (
              <p className="p-5 text-[12px] text-muted-foreground">{session.error ?? 'Opening chat'}</p>
            )}
          </div>
        );
      })}
    </div>
  );

  const preview = (
    <div className="relative min-h-0 min-w-0 flex-1">
      {validated ? (
        draft.hasView ? <AppView id={id} draft path="/" digest={draft.validatedDigest ?? ''} waiting={busy} onNavigate={() => {}} /> : <AppToolSummary id={id} draft />
      ) : (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-xs rounded-xl border border-dashed border-border px-6 py-8 text-center">
            <Hammer size={18} className="mx-auto text-muted-foreground/50" aria-hidden />
            <p className="mt-3 text-[12.5px] font-medium text-foreground">
              {building ? 'Building the preview' : 'The preview shows here'}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {building
                ? 'A minute or two. Keep talking to the builder meanwhile.'
                : 'Describe the app in the chat, then Build preview. The preview keeps its own records, separate from the app you use.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div ref={measureRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <AppHeader
        onBack={() => navigate('')}
        mark={<DraftMark />}
        title={draftTitle(draft, data.instances)}
        subtitle={`${status.label} · changed ${formatCompactRelative(draft.updatedAt)}`}
        pane={narrow ? { value: pane, options: PANES, onChange: setPane } : undefined}
      >
        {building ? (
          <>
            <span className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Building
            </span>
            <QuietAction onClick={() => void trpcClient.localApps.cancelBuild.mutate({ id })}>Cancel build</QuietAction>
          </>
        ) : (
          <QuietAction
            icon={<Play size={12} />}
            disabled={busy}
            onClick={() => void run(() => trpcClient.localApps.build.mutate({ id }))}
          >
            Build preview
          </QuietAction>
        )}
        <PrimaryAction
          disabled={busy || !validated}
          onClick={() =>
            void run(async () => {
              const result = await trpcClient.localApps.activate.mutate({ id, revision: data.revision });
              navigate(result.slug);
            })
          }
        >
          Use app
        </PrimaryAction>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconAction aria-label="More">
              <MoreHorizontal size={15} />
            </IconAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[170px]">
            <DropdownMenuItem onSelect={() => setShowOutput((value) => !value)}>
              <ScrollText size={13} /> {showOutput ? 'Hide output' : 'View output'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </AppHeader>

      {showOutput && <AppOutput id={id} draft live={building} />}
      {draft.buildError && (
        <p role="alert" className="flex-shrink-0 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-[11.5px] text-destructive">
          {draft.buildError}
        </p>
      )}

      {narrow ? (
        <div className="relative min-h-0 flex-1">
          {PANES.map(({ value }) => (
            <div
              key={value}
              inert={pane !== value}
              className={cn('absolute inset-0 flex min-h-0 flex-col', pane === value ? 'z-10' : 'opacity-0')}
            >
              {value === 'chat' ? chat : preview}
            </div>
          ))}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={defaultLayout ?? DEFAULT_LAYOUT}
          onLayoutChanged={onLayoutChanged}
          className="min-h-0 flex-1"
        >
          <ResizablePanel id={CHAT_PANEL} minSize={340} className="flex min-h-0 min-w-0 flex-col">
            {chat}
          </ResizablePanel>
          <ResizableHandle
            className={cn(
              'w-[3px] bg-border transition-colors hover:bg-primary/50',
              'after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5 after:w-auto after:translate-x-0',
            )}
          />
          <ResizablePanel id={PREVIEW_PANEL} minSize="32%" className="flex min-h-0 min-w-0 flex-col">
            {preview}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}

/** The draft's builder or try chat, opened the first time its tab is shown. */
function useDraftChat(draftId: string, entityType: 'app-builder' | 'app-try', enabled: boolean) {
  const chat = useQuery({
    queryKey: ['document-chat', entityType, draftId],
    queryFn: () => trpcClient.documentChat.list.query({ query: rpcQuery({ entityType, entityId: draftId }) }),
    enabled,
  });
  return { id: chat.data?.session.id ?? null, error: chat.error?.message ?? null };
}
