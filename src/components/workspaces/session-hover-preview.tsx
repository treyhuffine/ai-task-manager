'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Folder, User } from 'lucide-react';
import { useSession, useSessionEvents } from '@/hooks/use-execution';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { useAreas } from '@/hooks/use-areas';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageResponse } from '@/components/ai-elements/message';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { conversationText, pickConversationMessages } from '@/lib/executions/conversation';
import { cn } from '@/lib/utils';
import type { ChatEventRecord, ChatSessionRecord, WorkspaceRecord, AreaRecord } from '@/db/types';
import { useSessionHover } from './session-hover-context';

const PANEL_WIDTH = 360;
const PANEL_GAP = 8;
const PANEL_MAX_HEIGHT = 520;
const VIEWPORT_MARGIN = 8;
const MAX_PREVIEW_MESSAGES = 8;
/**
 * Height cap for every message except the newest, which renders in full.
 * Roughly eight lines at 11px — enough to recognize a turn without
 * letting one long paste bury the reply the hover is actually about.
 */
const OLDER_MESSAGE_MAX_HEIGHT = 108;

interface PanelPosition {
  top: number;
  left: number;
  maxHeight: number;
}

/**
 * Floating chat-preview panel anchored to the rail row currently being
 * hovered. Single panel for the whole rail — `SessionHoverProvider`
 * tracks which session is hovered, this component renders one panel
 * positioned next to that row's vertical center.
 *
 * The panel is itself hoverable: moving the cursor over it cancels the
 * pending close, so users can pause to read.
 */
export function SessionHoverPreview() {
  const { state, cancelClose, onRowLeave } = useSessionHover();

  return state ? (
    <PreviewPortal
      sessionId={state.sessionId}
      anchorTop={state.anchor.top}
      anchorBottom={state.anchor.bottom}
      railRight={state.anchor.railRight}
      onMouseEnter={cancelClose}
      onMouseLeave={onRowLeave}
    />
  ) : null;
}

interface PreviewPortalProps {
  sessionId: string;
  anchorTop: number;
  anchorBottom: number;
  railRight: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function PreviewPortal({
  sessionId,
  anchorTop,
  anchorBottom,
  railRight,
  onMouseEnter,
  onMouseLeave,
}: PreviewPortalProps) {
  const { closeNow } = useSessionHover();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const panelRef = useRef<HTMLDivElement | null>(null);

  // A scroll outside the panel (rail body, window, an ancestor) shifts
  // the anchored row without updating the stored anchor, leaving the
  // panel stranded in a stale spot — close it. Scrolls *inside* the
  // panel's own message list must be ignored, or it dismisses itself the
  // instant the user tries to read past the fold. Capture phase is
  // required: scroll events don't bubble, but they do reach listeners on
  // the way down, and `e.target` is always the element that scrolled.
  useEffect(() => {
    const handler = (e: Event) => {
      const panel = panelRef.current;
      if (panel && e.target instanceof Node && panel.contains(e.target)) return;
      closeNow();
    };
    window.addEventListener('scroll', handler, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', handler, { capture: true });
  }, [closeNow]);
  // `null` until first measurement — the panel renders hidden on the
  // initial frame so a wrong-height estimate doesn't flash the panel at
  // the top of the viewport before snapping back to the row.
  const [pos, setPos] = useState<PanelPosition | null>(null);

  const reposition = () => {
    const measured =
      panelRef.current?.getBoundingClientRect().height ?? PANEL_MAX_HEIGHT;
    setPos((prev) => {
      const next = computePosition(anchorTop, anchorBottom, railRight, measured);
      if (
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.maxHeight === next.maxHeight
      ) {
        return prev;
      }
      return next;
    });
  };

  // Reposition synchronously before paint whenever the anchor changes
  // (cursor moved to another row). Runs once on mount to convert the
  // hidden-first state into the real position.
  useLayoutEffect(reposition, [anchorTop, anchorBottom, railRight]);

  // Repaint when the panel's own height changes — content arriving
  // async (events finish loading, more messages stream in) grows the
  // panel; we want the anchor center to track that.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => reposition());
    ro.observe(el);
    return () => ro.disconnect();
    // reposition closes over anchor props; deps cover them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorTop, anchorBottom, railRight]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Session preview"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: PANEL_WIDTH,
        maxHeight: pos?.maxHeight ?? PANEL_MAX_HEIGHT,
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 40,
      }}
      className={cn(
        'flex flex-col rounded-lg border border-border bg-popover shadow-xl',
        pos && 'animate-in fade-in zoom-in-95 duration-150',
      )}
    >
      <PreviewBody sessionId={sessionId} />
    </div>,
    document.body,
  );
}

function computePosition(
  anchorTop: number,
  _anchorBottom: number,
  railRight: number,
  panelHeight: number,
): PanelPosition {
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  const left = railRight + PANEL_GAP;

  // Top-align the panel with the row. This is the convention for side
  // previews (Slack threads, Linear sidebar) and is what makes the panel
  // read as "attached to" the row instead of floating somewhere nearby.
  let top = anchorTop;

  // Cap height to whatever fits in the viewport so we never have to
  // shift the panel above the row's top to make room.
  const maxHeight = Math.min(PANEL_MAX_HEIGHT, viewportHeight - VIEWPORT_MARGIN * 2);
  const effectiveHeight = Math.min(panelHeight, maxHeight);

  // Only shift up if the bottom would overflow — and shift just enough
  // to fit. Floor at VIEWPORT_MARGIN so an absurdly short viewport
  // doesn't push the top off-screen.
  const overflow = top + effectiveHeight - (viewportHeight - VIEWPORT_MARGIN);
  if (overflow > 0) top = Math.max(VIEWPORT_MARGIN, top - overflow);

  return { top, left, maxHeight };
}

function PreviewBody({ sessionId }: { sessionId: string }) {
  const { data: session } = useSession(sessionId);
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const { data: areas } = useAreas();
  const { data: events, isLoading } = useSessionEvents(sessionId);

  const workspace = useMemo(
    () => (session?.workspaceId ? workspaces?.find((w) => w.id === session.workspaceId) : undefined),
    [session?.workspaceId, workspaces],
  );
  const area = useMemo(
    () => (workspace?.areaId ? areas?.find((a) => a.id === workspace.areaId) : undefined),
    [workspace?.areaId, areas],
  );

  const messages = useMemo(
    () => pickConversationMessages(events ?? [], MAX_PREVIEW_MESSAGES),
    [events],
  );

  return (
    <div className="flex flex-col min-h-0">
      <PreviewHeader session={session} workspace={workspace} area={area} />
      {isLoading && !events ? (
        <PreviewSkeleton />
      ) : messages.length === 0 ? (
        <div className="px-4 py-6 text-center text-[11px] text-muted-foreground/70 italic">
          No messages yet.
        </div>
      ) : (
        // Keyed by session so moving to another row resets the scroll
        // position instead of inheriting the previous row's.
        <PreviewMessages key={sessionId} messages={messages} />
      )}
    </div>
  );
}

/** Slack from the bottom edge that still counts as "at the bottom". */
const STICK_THRESHOLD = 24;

/**
 * Message list, opened at the bottom. The newest turn is what the user
 * hovered to see, so the panel starts at the end of the transcript with
 * older turns scrollable above — same reading position as opening the
 * chat itself.
 *
 * The jump lands before paint (`useLayoutEffect`) so the list never
 * flashes at the top, and repeats whenever the slice changes: events
 * finish loading and replace an empty first render, or a live session
 * appends a turn while the panel is open.
 *
 * It yields to the user, though. Once they scroll up to read, the panel
 * stops re-pinning — a live session streaming in shouldn't yank them
 * back down mid-sentence. Scrolling back to the bottom re-arms it.
 * `PreviewBody` keys this component by session, so hovering another row
 * remounts it and starts at the bottom again.
 */
function PreviewMessages({ messages }: { messages: ChatEventRecord[] }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Runs for programmatic scrolls too, which is what re-arms sticking
  // after the effect above pins the list.
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  };

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-2.5"
    >
      {messages.map((m, i) => (
        <PreviewMessage key={m.id} event={m} full={i === messages.length - 1} />
      ))}
    </div>
  );
}

function PreviewHeader({
  session,
  workspace,
  area,
}: {
  session: ChatSessionRecord | undefined;
  workspace: WorkspaceRecord | undefined;
  area: AreaRecord | undefined;
}) {
  // Icon resolution mirrors WorkspaceRow: workspace's own image / emoji,
  // falling back to the linked area's, then a default folder glyph.
  const wsImage = workspace ? coverAttachmentUrl(workspace.attachments) : null;
  const areaImage = area ? coverAttachmentUrl(area.attachments) : null;
  const iconImage = wsImage ?? (workspace?.emoji ? null : areaImage);
  const iconEmoji = workspace?.emoji ?? (wsImage ? null : area?.emoji ?? null);

  const label = session?.label ?? null;
  const labelText = label ?? 'Untitled';
  const labelIsPlaceholder = !label;
  const wsName = workspace?.name ?? 'No workspace';

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 border-b border-border/60">
      <span
        className="relative w-7 h-7 flex items-center justify-center flex-shrink-0 rounded-md bg-muted/60"
        aria-hidden
      >
        {iconImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={iconImage} alt="" className="w-7 h-7 rounded-md object-cover" />
        ) : iconEmoji ? (
          <span className="text-base leading-none">{iconEmoji}</span>
        ) : (
          <Folder size={14} className="text-muted-foreground/70" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            'text-[12px] truncate leading-tight',
            labelIsPlaceholder ? 'italic text-muted-foreground/80' : 'font-semibold text-foreground',
          )}
        >
          {labelText}
        </div>
        <div className="text-[10px] text-muted-foreground/80 truncate mt-0.5">
          {wsName}
        </div>
      </div>
    </div>
  );
}

/**
 * Body-only skeleton — the real header is always rendered by
 * `PreviewBody` so it doesn't flash in when events arrive. This fills
 * the message list area with three alternating-role placeholders of
 * varying widths so the shape reads as "chat" rather than loading bars.
 */
function PreviewSkeleton() {
  const rows: Array<{ role: 'user' | 'agent'; widths: string[] }> = [
    { role: 'user', widths: ['85%', '60%'] },
    { role: 'agent', widths: ['95%', '80%', '70%'] },
    { role: 'user', widths: ['70%'] },
  ];
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-2.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-2">
          <Skeleton
            className={cn(
              'flex-shrink-0 w-4 h-4 rounded mt-0.5',
              row.role === 'user' ? 'bg-foreground/10' : 'bg-primary/15',
            )}
          />
          <div className="flex-1 min-w-0 space-y-1">
            <Skeleton className="h-2 w-10 rounded-sm bg-muted/70" />
            <div className="space-y-1 pt-0.5">
              {row.widths.map((w, j) => (
                <Skeleton
                  key={j}
                  className="h-2.5 rounded-sm bg-muted/60"
                  style={{ width: w }}
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * `full` renders the message uncapped. It's set for the newest message
 * only: that's the one the hover is asking about, and the panel already
 * opens scrolled to it. Earlier messages keep a height cap so a long
 * back-and-forth doesn't push the recent turn out of view — they're
 * context, and the whole thing is one click away in the chat.
 */
function PreviewMessage({ event, full }: { event: ChatEventRecord; full?: boolean }) {
  const isUser = event.source === 'user';
  const content = conversationText(event);
  return (
    <div className="flex items-start gap-2">
      <span
        className={cn(
          'flex-shrink-0 w-4 h-4 rounded flex items-center justify-center mt-0.5',
          isUser ? 'bg-foreground/10 text-foreground' : 'bg-primary/10 text-primary',
        )}
        aria-hidden
      >
        {isUser ? <User size={9} /> : <Bot size={9} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70 mb-0.5">
          {isUser ? 'You' : 'Agent'}
        </div>
        {content ? (
          <MessageBody text={content} full={full} />
        ) : (
          <p className="text-[11px] leading-snug italic text-muted-foreground/60">(no text)</p>
        )}
      </div>
    </div>
  );
}

/**
 * Message text as rendered markdown — same renderer as the transcript
 * (`MessageResponse` → Streamdown), so a preview reads the way the chat
 * does: headings, lists, tables, inline code, links.
 *
 * Two deviations from the transcript, both about size. Plugins are off
 * (`plugins={{}}`): syntax highlighting, math, and mermaid all render
 * async and are illegible in a 360px column, so fences fall back to
 * plain `<pre>`. Controls are off too — a copy/download bar on a hover
 * card is chrome nobody can reach before the card closes.
 *
 * Capped messages get a fade at the cut so the clip reads as
 * intentional. Whether it's clipped has to be measured (the wrapper's
 * own height is pinned to the cap, so the inner block is what's
 * observed) — a fade painted unconditionally would wash out the last
 * line of every short message.
 */
function MessageBody({ text, full }: { text: string; full?: boolean }) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    if (full) {
      setClipped(false);
      return;
    }
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setClipped(el.offsetHeight > OLDER_MESSAGE_MAX_HEIGHT);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // Content settles after mount (fonts, tables reflowing at 360px), and
    // the capped wrapper can't report that growth itself.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, full]);

  return (
    <div
      className="relative overflow-hidden"
      style={full ? undefined : { maxHeight: OLDER_MESSAGE_MAX_HEIGHT }}
    >
      <div ref={innerRef}>
        <MessageResponse
          className="preview-markdown !size-auto text-foreground/90"
          plugins={{}}
          controls={false}
        >
          {text}
        </MessageResponse>
      </div>
      {clipped && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-popover to-transparent"
          aria-hidden
        />
      )}
    </div>
  );
}
