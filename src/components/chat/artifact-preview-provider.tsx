'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { HtmlView } from '@/components/executions/viewer/html-view';
import { sessionFolder } from '@/lib/folders/source';
import { PreviewImage } from './preview-image';

type Preview = {
  kind: 'html';
  sessionId: string;
  path: string;
} | { kind: 'image'; src: string; name: string; alt: string };

const ArtifactPreviewContext = createContext<((preview: Preview, trigger: HTMLElement) => void) | null>(null);

/** Keep the preview outside responsive transcript subtrees so resizing or
 * virtualizing its original message does not discard the artifact's state. */
export function ArtifactPreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const open = useCallback((next: Preview, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setPreview(next);
  }, []);
  return (
    <ArtifactPreviewContext.Provider value={open}>
      {children}
      <Dialog open={!!preview} onOpenChange={value => { if (!value) setPreview(null); }}>
        <DialogContent
          className="flex h-[90dvh] w-[calc(100%-2rem)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[min(90vw,1440px)]"
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (triggerRef.current?.isConnected) triggerRef.current.focus();
          }}
        >
          <div className="min-w-0 shrink-0 border-b border-border px-4 py-3 pr-14">
            <DialogTitle className="truncate text-sm">{preview?.kind === 'html' ? preview.path.split('/').at(-1) : preview?.name}</DialogTitle>
            <DialogDescription className="sr-only">{preview?.kind === 'html' ? 'Interactive HTML preview' : 'Full-size image'}</DialogDescription>
          </div>
          <div className="min-h-0 flex-1">
            {preview?.kind === 'html' && <HtmlView key={`${preview.sessionId}:${preview.path}`} source={sessionFolder(preview.sessionId)} path={preview.path} />}
            {preview?.kind === 'image' && <PreviewImage key={preview.src} src={preview.src} alt={preview.alt || preview.name} className="h-full w-full object-contain p-3" />}
          </div>
        </DialogContent>
      </Dialog>
    </ArtifactPreviewContext.Provider>
  );
}

export function useArtifactPreview() {
  const open = useContext(ArtifactPreviewContext);
  if (!open) throw new Error('useArtifactPreview must be used within ArtifactPreviewProvider');
  return open;
}
