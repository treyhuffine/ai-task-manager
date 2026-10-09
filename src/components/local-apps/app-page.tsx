'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDefaultLayout, type Layout, type LayoutStorage } from 'react-resizable-panels';
import { Archive, Download, KeyRound, MessageSquare, MoreHorizontal, Pencil, Power, ScrollText, Settings2 } from 'lucide-react';
import { HarnessChatSession } from '@/components/chat/harness-chat';
import type { MainChatIntro } from '@/components/chat/main-chat-intro';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useElementWidth } from '@/hooks/use-element-width';
import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
import { cn } from '@/lib/utils';
import { AppApprovalBanner } from './app-approval-banner';
import { AppHeader, IconAction, PrimaryAction, QuietAction } from './app-header';
import { useAppAccess, type LocalAppInstance, type LocalAppsList } from './app-hooks';
import { AppMark } from './app-mark';
import { AppOutput } from './app-output';
import { AppSettingsDialog } from './app-settings-dialog';
import { AppToolSummary } from './app-tool-summary';
import { AppView } from './app-view';
import { appCondition } from './app-copy';
import { draftRoute } from './app-places';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AppGrantEditor } from './grant-editor';
import { useAppAction } from './use-app-action';

const CHAT_PANEL = 'app-chat';
const APP_PANEL = 'app-view';
const DEFAULT_LAYOUT: Layout = { [CHAT_PANEL]: 38, [APP_PANEL]: 62 };
const NOOP_STORAGE: LayoutStorage = { getItem: () => null, setItem: () => {} };
/** Below this width the view shows one pane at a time, as the agent view does. */
const NARROW_WIDTH = 820;

type Pane = 'chat' | 'app';
const PANES: ReadonlyArray<{ value: Pane; label: string }> = [
  { value: 'chat', label: 'Chat' },
  { value: 'app', label: 'App' },
];

/**
 * An installed app, full screen: the app itself, and Ask Ri beside it when
 * you want to talk about what's on screen. Same shape as the agent and skill
 * views (chat on the left, the thing on the right), so the app is where the
 * artifact always is. Change app opens a draft of it in the builder; the
 * rest of its management sits behind More and Settings.
 */
export function AppPage({
  instance,
  data,
  path,
  query,
  navigate,
}: {
  instance: LocalAppInstance;
  data: LocalAppsList;
  path: string;
  query: Record<string, string>;
  navigate: (route: string) => void;
}) {
  const id = instance.id;
  const { riAccessChat, ...viewQuery } = query;
  const [accessOpen, setAccessOpen] = useState(!!riAccessChat);
  const { busy, run } = useAppAction();
  const [ask, setAsk] = useState(false);
  const [pane, setPane] = useState<Pane>('app');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [measureRef, width] = useElementWidth<HTMLDivElement>();
  const narrow = width !== null && width < NARROW_WIDTH;

  const [storage] = useState<LayoutStorage>(() => (typeof window === 'undefined' ? NOOP_STORAGE : window.localStorage));
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'ri.app.layout', storage });

  const chat = useQuery({
    queryKey: ['document-chat', 'app', id],
    queryFn: () => trpcClient.documentChat.list.query({ query: rpcQuery({ entityType: 'app', entityId: id }) }),
    enabled: ask,
  });
  const chatId = ask ? (chat.data?.session.id ?? null) : null;
  const access = useAppAccess(id, chatId, data.revision);
  const chatGrant =
    !!chatId &&
    data.grants.some(
      (item) => item.instanceId === id && item.principal.kind === 'chat' && item.principal.id === chatId && !item.revokedAt,
    );
  // The view opens as the chat only once the chat is allowed in. Before
  // that it stays your own view, so Ask Ri never blanks the app.
  const viewChatId = chatGrant ? (chatId ?? undefined) : undefined;

  const approval = data.approvals.find((item) => item.instanceId === id);
  const owner = data.grants.findLast(
    (item) => item.instanceId === id && item.principal.kind === 'owner-ui' && !item.revokedAt,
  );
  const condition = appCondition(instance);
  const openable = instance.enabled && !instance.archived;

  const changeApp = () =>
    run(async () => {
      const draft = await trpcClient.localApps.createDraft.mutate({ sourceInstanceId: id });
      navigate(draftRoute(draft.id));
    });
  const configure = (patch: { enabled?: boolean; archived?: boolean }) =>
    run(() => trpcClient.localApps.configure.mutate({ id, revision: data.revision, patch }));
  const exportPackage = () =>
    run(async () => {
      const result = await trpcClient.localApps.export.mutate({ id });
      window.location.assign(`/api/local-apps/export/${result.name}`);
    });

  const app = (
    <div className="relative min-h-0 min-w-0 flex-1">
      {openable ? (!instance.hasView ? <AppToolSummary id={id} /> :
        <AppView
          id={id}
          path={path}
          query={viewQuery}
          chatId={viewChatId}
          waiting={!!approval || busy}
          changeRevision={instance.changeRevision}
          authorityRevision={(access.data?.revision ?? 0) * 100000 + (owner?.revision ?? 0)}
          digest={instance.digest}
          onNavigate={(value) => navigate(`${instance.slug}${value}`)}
        />
      ) : (
        <div className="flex h-full items-center justify-center px-8 text-center">
          <div>
            <p className="text-[13px] font-semibold text-foreground">
              {instance.archived ? 'This app is archived.' : 'This app is off.'}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              {instance.archived
                ? 'Its records are kept. Enable it from Settings to open it again.'
                : 'Enable it from Settings to open it.'}
            </p>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="mt-3 inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10"
            >
              Open Settings
            </button>
          </div>
        </div>
      )}
      {approval && (
        <p className="absolute bottom-3 left-3 rounded-md border border-border bg-background/95 px-3 py-1.5 text-[11px] text-muted-foreground shadow">
          Waiting for your decision above. The app refreshes once the action finishes.
        </p>
      )}
    </div>
  );

  const chatPane = (
    <div className="flex h-full min-h-0 flex-col">
      {chatId && !chatGrant && <ChatAccessPrompt instanceId={id} chatId={chatId} name={instance.displayName} />}
      {chatId ? (
        <HarnessChatSession
          key={chatId}
          sessionId={chatId}
          composerPlaceholder={`Ask about ${instance.displayName}`}
          intro={askIntro(instance.displayName)}
        />
      ) : (
        <p className="p-5 text-[12px] text-muted-foreground">{chat.error?.message ?? 'Opening chat'}</p>
      )}
    </div>
  );

  return (
    <div ref={measureRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <AppHeader
        onBack={() => navigate('')}
        mark={<AppMark name={instance.displayName} size="md" />}
        title={instance.displayName}
        subtitle={`${condition.label} · ${instance.version}`}
        pane={ask && narrow ? { value: pane, options: PANES, onChange: setPane } : undefined}
      >
        <QuietAction
          icon={<MessageSquare size={12} />}
          pressed={ask}
          onClick={() => {
            setAsk((value) => !value);
            setPane('chat');
          }}
        >
          Ask Ri
        </QuietAction>
        <PrimaryAction icon={<Pencil size={12} strokeWidth={2.5} />} disabled={busy} onClick={() => void changeApp()}>
          Change app
        </PrimaryAction>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconAction aria-label="More">
              <MoreHorizontal size={15} />
            </IconAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[190px]">
            <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
              <Settings2 size={13} /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShowOutput((value) => !value)}>
              <ScrollText size={13} /> {showOutput ? 'Hide output' : 'View output'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportPackage()}>
              <Download size={13} /> Export package
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={busy} onSelect={() => void configure({ enabled: !instance.enabled, archived: false })}>
              <Power size={13} /> {instance.enabled ? 'Disable' : 'Enable'}
            </DropdownMenuItem>
            {!instance.archived && (
              <DropdownMenuItem
                disabled={busy}
                onSelect={() => void configure({ archived: true, enabled: false })}
                className="text-destructive focus:text-destructive"
              >
                <Archive size={13} /> Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </AppHeader>

      {showOutput && <AppOutput id={id} draft={false} />}
      {approval && (
        <AppApprovalBanner
          approval={approval}
          busy={busy}
          onDecide={(approve) => void run(() => trpcClient.localApps.approval.mutate({ id: approval.id, approve }))}
        />
      )}

      {!ask ? (
        app
      ) : narrow ? (
        <div className="relative min-h-0 flex-1">
          {PANES.map(({ value }) => (
            <div
              key={value}
              inert={pane !== value}
              className={cn('absolute inset-0 flex min-h-0 flex-col', pane === value ? 'z-10' : 'opacity-0')}
            >
              {value === 'chat' ? chatPane : app}
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
            {chatPane}
          </ResizablePanel>
          <ResizableHandle
            className={cn(
              'w-[3px] bg-border transition-colors hover:bg-primary/50',
              'after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5 after:w-auto after:translate-x-0',
            )}
          />
          <ResizablePanel id={APP_PANEL} minSize="32%" className="flex min-h-0 min-w-0 flex-col">
            {app}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <Dialog open={accessOpen} onOpenChange={setAccessOpen}><DialogContent className="max-h-[85vh] overflow-auto"><DialogHeader><DialogTitle>Allow access to {instance.displayName}</DialogTitle></DialogHeader>{riAccessChat && <AppGrantEditor instanceId={id} chatId={riAccessChat} onSaved={() => setAccessOpen(false)} />}</DialogContent></Dialog>
      <AppSettingsDialog
        instance={instance}
        data={data}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onRemoved={() => navigate('')}
      />
    </div>
  );
}

/** The Ask Ri chat's first words: what it can see, once the chat is allowed in. */
function askIntro(name: string): MainChatIntro {
  return {
    title: `Ask about ${name}`,
    description: `Once this chat is allowed into ${name}, it can read what's on screen and use the actions you allow. Ask what the numbers mean, what to do next, or for a change to the app itself.`,
    starters: [
      { label: 'What am I looking at?', prompt: `Explain what's on screen in ${name} right now.` },
      { label: 'What stands out?', prompt: `Look at ${name} and tell me what stands out, and what I should do about it.` },
    ],
  };
}

/**
 * A chat that hasn't been allowed into the app yet: one line saying so and
 * the grant editor behind it, so the chat opens clean and access is a
 * choice you make in place.
 */
function ChatAccessPrompt({ instanceId, chatId, name }: { instanceId: string; chatId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex-shrink-0 border-b border-border/60">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground">
        <KeyRound size={12} className="flex-shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">This chat can&apos;t use {name} yet.</span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-md px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
        >
          {open ? 'Later' : 'Allow access'}
        </button>
      </div>
      {open && (
        <div className="max-h-[50vh] overflow-y-auto border-t border-border/60 p-3">
          <AppGrantEditor instanceId={instanceId} chatId={chatId} onSaved={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
