'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

/**
 * `ExecutionView` behind a split point.
 *
 * The view drags in xterm, CodeMirror, and the diff/merge machinery —
 * roughly 1.5MB — and both layouts render it conditionally:
 *
 *     {isExecutionView ? <ExecutionView … /> : <PanelLayout />}
 *
 * A static import gives the bundler no way to see that condition, so all of
 * it landed in the first-load chunk of every page, including the ones that
 * never open an execution. Importing through `dynamic()` turns that edge
 * into a function call, which is the seam the bundler needs to emit a
 * separate chunk and fetch it on first render.
 *
 * Both call sites import from here rather than each calling `dynamic()`
 * themselves, so desktop and mobile share one chunk and one loading state
 * instead of producing two copies.
 *
 * `ssr: false` because the view is not server-renderable in any useful
 * sense: xterm measures a real DOM to size the terminal, and CodeMirror
 * wants a live document. Rendering it on the server would only produce
 * markup the client immediately throws away.
 */
export const ExecutionView = dynamic(
  () => import('./execution-view').then((m) => m.ExecutionView),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center bg-background">
        <Loader2 size={16} className="animate-spin text-muted-foreground/50" />
      </div>
    ),
  },
);
