"use client";

import { useEffect, useState } from 'react';
import {
  useDefaultLayout,
  useGroupRef,
  type Layout,
  type LayoutStorage,
} from 'react-resizable-panels';
import { useDashboard } from '@/contexts/dashboard-context';
import { ContentPanel } from './content-panel';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

// Split-panel sizing lives entirely inside react-resizable-panels — it owns
// percentages and the keyboard-accessible handle. `useDefaultLayout` handles
// localStorage persistence; we expose an imperative reset to the dashboard
// context so `resetLayout` can snap the divider back without lifting state up.
//
// v4 quirk: numeric size props are PIXELS; percentages must be strings.
const PANEL_A = 'panel-a';
const PANEL_B = 'panel-b';
const DEFAULT_SIZE = '50%';
const MIN_SIZE = '25%';
const MAX_SIZE = '75%';
const STORAGE_ID = 'flow.dashboard.panel-layout';

// Layout values are flexGrow numbers (not percentages); equal numbers = equal share.
const DEFAULT_LAYOUT: Layout = {
  [PANEL_A]: 50,
  [PANEL_B]: 50,
};

// react-resizable-panels defaults `storage = localStorage` via a default
// parameter, which evaluates at render time and crashes during SSR with
// ReferenceError. Passing `undefined` triggers the default — so we need
// a real shim here, not undefined.
const NOOP_STORAGE: LayoutStorage = {
  getItem: () => null,
  setItem: () => {},
};

export function PanelLayout() {
  const { registerPanelLayoutReset, resetLayout } = useDashboard();
  const groupRef = useGroupRef();
  // Lazy init so SSR sees the noop shim; client picks up real localStorage
  // on mount. Accepts the documented slight layout shift for server-rendered
  // percentages.
  const [storage] = useState<LayoutStorage>(() =>
    typeof window === 'undefined' ? NOOP_STORAGE : window.localStorage,
  );
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: STORAGE_ID,
    storage,
  });

  useEffect(() => {
    registerPanelLayoutReset(() => {
      groupRef.current?.setLayout(DEFAULT_LAYOUT);
    });
    return () => registerPanelLayoutReset(null);
  }, [registerPanelLayoutReset, groupRef]);

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden relative">
      <ResizablePanelGroup
        orientation="horizontal"
        groupRef={groupRef}
        defaultLayout={defaultLayout ?? DEFAULT_LAYOUT}
        onLayoutChanged={onLayoutChanged}
        className="flex-1"
      >
        <ResizablePanel
          id={PANEL_A}
          defaultSize={DEFAULT_SIZE}
          minSize={MIN_SIZE}
          maxSize={MAX_SIZE}
          className="flex flex-col min-w-0 min-h-0"
        >
          <ContentPanel panelId="a" />
        </ResizablePanel>

        <ResizableHandle
          className={cn(
            'w-[3px] bg-border hover:bg-primary/50 transition-colors',
            // Wider hit target via the ::after pseudo, without making the visible bar wider.
            'after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5 after:w-auto after:translate-x-0',
          )}
        />

        <ResizablePanel
          id={PANEL_B}
          defaultSize={DEFAULT_SIZE}
          minSize={MIN_SIZE}
          maxSize={MAX_SIZE}
          className="flex flex-col min-w-0 min-h-0"
        >
          <ContentPanel panelId="b" />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Reset layout — context.resetLayout snaps tabs + focus + panel split */}
      <button
        onClick={resetLayout}
        title="Reset layout to default"
        className={cn(
          'absolute bottom-3 left-1/2 -translate-x-1/2 z-40',
          'p-1.5 rounded-lg border border-border bg-card text-muted-foreground',
          'hover:text-foreground hover:border-primary/30 transition-all',
          'opacity-0 hover:opacity-100 focus:opacity-100',
        )}
      >
        <RotateCcw size={12} />
      </button>
    </div>
  );
}
