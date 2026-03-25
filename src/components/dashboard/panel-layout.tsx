"use client";

import { useRef, useCallback } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { ContentPanel } from './content-panel';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PanelLayout() {
  const { dividerPosition, setDividerPosition, resetLayout } = useDashboard();
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = (x / rect.width) * 100;
      setDividerPosition(Math.min(75, Math.max(25, pct)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [setDividerPosition]);

  return (
    <div ref={containerRef} className="flex-1 flex min-h-0 overflow-hidden relative">
      {/* Panel A */}
      <div style={{ width: `${dividerPosition}%` }} className="flex flex-col min-w-0">
        <ContentPanel panelId="a" />
      </div>

      {/* Draggable divider */}
      <div
        onMouseDown={handleMouseDown}
        className="w-[3px] bg-border hover:bg-primary/50 cursor-col-resize flex-shrink-0 transition-colors relative group"
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Panel B */}
      <div style={{ width: `${100 - dividerPosition}%` }} className="flex flex-col min-w-0">
        <ContentPanel panelId="b" />
      </div>

      {/* Reset layout button */}
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
