'use client';

import { openSettings } from '@/components/settings/settings-store';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useDashboard } from '@/contexts/dashboard-context';
import { useElementWidth } from '@/hooks/use-element-width';
import { useSkill } from '@/hooks/use-skills';
import { apiErrorStatus } from '@/lib/api/client';
import { sessionsApi } from '@/lib/api/sessions';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDefaultLayout, type Layout, type LayoutStorage } from 'react-resizable-panels';
import { SkillChatPanel } from './skill-chat-panel';
import { SkillEditor } from './skill-editor';
import { SkillHeader, type SkillPane } from './skill-header';
import { useSkillChat } from './use-skill-chat';

/**
 * A skill's builder (docs/skills.md): the chat that writes it with you on
 * the left (Build, and Try it), the skill itself on the right. Write by hand,
 * with the AI, or both. The AI writes through Ri's skill actions, and while
 * it works the editor follows its changes.
 *
 * Same shape and narrow-mode rule as the agent view: below `NARROW_WIDTH`
 * of its own width it shows one pane at a time, with both kept mounted.
 */

const CHAT_PANEL = 'skill-chat';
const EDITOR_PANEL = 'skill-editor';
const DEFAULT_LAYOUT: Layout = { [CHAT_PANEL]: 40, [EDITOR_PANEL]: 60 };
const NOOP_STORAGE: LayoutStorage = { getItem: () => null, setItem: () => {} };
const NARROW_WIDTH = 820;

export function SkillView({
  skillRef,
  onBack,
  assumeNarrow = false,
}: {
  /** The skill's ref (`ri:<name>`, `global:<name>`, `project:<workspaceId>:<name>`). */
  skillRef: string;
  onBack?: () => void;
  assumeNarrow?: boolean;
}) {
  const [measureRef, width] = useElementWidth<HTMLDivElement>();
  const narrow = width === null ? assumeNarrow : width < NARROW_WIDTH;
  const [pane, setPane] = useState<SkillPane>('chat');
  // While the builder AI is working, poll the skill so its edits show up as
  // they land, not only when its turn ends.
  const build = useSkillChat(skillRef, 'build');
  const { data: skill, isLoading, error } = useSkill(skillRef, { live: build.isActive });
  const { goHome, openSkill } = useDashboard();

  // Renamed elsewhere (the builder AI names a new draft, or another tab):
  // the skill's chats move with it, so the builder chat knows where it went.
  const gone = apiErrorStatus(error) !== undefined && apiErrorStatus(error) === 404;
  const buildSessionId = build.sessionId;
  useEffect(() => {
    if (!gone || !buildSessionId) return;
    let cancelled = false;
    void sessionsApi
      .get(buildSessionId)
      .then((session) => {
        if (!cancelled && session.surfaceKind === 'skill' && session.surfaceRef && session.surfaceRef !== skillRef) {
          openSkill(session.surfaceRef, { replace: true });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gone, buildSessionId, skillRef, openSkill]);

  const [storage] = useState<LayoutStorage>(() => (typeof window === 'undefined' ? NOOP_STORAGE : window.localStorage));
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'ri.skill.layout', storage });

  const frame = (children: React.ReactNode) => (
    <div ref={measureRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {children}
    </div>
  );

  if (isLoading) {
    return frame(
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>,
    );
  }

  if (!skill) {
    return frame(
      <div className="flex flex-1 items-center justify-center px-8 text-center">
        <div>
          <p className="text-[13px] font-semibold text-foreground">
            {apiErrorStatus(error) !== undefined && apiErrorStatus(error) === 404 ? 'This skill isn’t here anymore.' : 'Couldn’t load this skill.'}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            {apiErrorStatus(error) !== undefined && apiErrorStatus(error) === 404 ? 'It may have been renamed or archived.' : 'Try again in a moment.'}
          </p>
          <div className="mt-3 flex justify-center gap-1">
            <button
              onClick={() => openSettings('plugins', { anchor: 'skills' })}
              className="inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10"
            >
              Open Plugins
            </button>
            <button
              onClick={goHome}
              className="inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>,
    );
  }

  // Keyed by ref so a rename, a move or a switch between skills starts clean.
  const chat = <SkillChatPanel key={`chat:${skill.ref}`} skill={skill} />;
  const editor = <SkillEditor key={`editor:${skill.ref}`} skill={skill} aiWriting={build.isActive} />;

  return frame(
    <>
      <SkillHeader skill={skill} onBack={onBack} pane={narrow ? { value: pane, onChange: setPane } : undefined} />
      {narrow ? (
        <div className="relative min-h-0 flex-1">
          {(['chat', 'skill'] as const).map((p) => (
            <div
              key={p}
              inert={pane !== p}
              className={cn('absolute inset-0 flex min-h-0 flex-col', pane === p ? 'z-10' : 'opacity-0')}
            >
              {p === 'chat' ? chat : editor}
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
          <ResizablePanel id={EDITOR_PANEL} minSize="32%" className="flex min-h-0 min-w-0 flex-col">
            {editor}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </>,
  );
}
