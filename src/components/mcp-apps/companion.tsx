'use client';
import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { useElementWidth } from '@/hooks/use-element-width';
import { ConnectedView } from './view';
import { ConnectedCompanionContext } from '@/lib/client/mcp-app-panel';

export function ConnectedCompanion({chatId, children}: {chatId: string; children: (open: boolean) => React.ReactNode}) {
  const [captureId, open] = useState<string | null>(null);
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  const [inlineIds, setInlineIds] = useState<Set<string>>(() => new Set());
  const register = useCallback((id: string) => {
    setInlineIds(previous => new Set([...previous, id]));
    return () => setInlineIds(previous => {const next = new Set(previous); next.delete(id); return next;});
  }, []);
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const side = width === null || width >= 820;
  return <ConnectedCompanionContext.Provider value={{captureId, open, mount, register}}><div ref={ref} className={`flex min-h-0 min-w-0 flex-1 ${side ? 'flex-row' : 'flex-col'}`}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children(!!captureId)}</div>
    <aside aria-label="Connected app beside this chat" className={`${captureId ? 'flex' : 'hidden'} min-h-0 flex-col bg-background ${side ? 'w-[min(45%,640px)] border-l' : 'h-[50%] border-t'} border-border`}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs"><span>App beside this chat</span><button aria-label="Close app" onClick={() => open(null)} className="rounded p-1 hover:bg-muted"><X size={14}/></button></div>
      <div ref={setMount} className="min-h-0 flex-1 overflow-auto">{captureId && !inlineIds.has(captureId) && <ConnectedView key={captureId} captureId={captureId} chatId={chatId} expanded />}</div>
    </aside>
  </div></ConnectedCompanionContext.Provider>;
}
