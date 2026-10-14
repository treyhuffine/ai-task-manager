'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { HtmlView } from '@/components/executions/viewer/html-view';
import { sessionFolder } from '@/lib/folders/source';
import { artifactImageSource } from '@/lib/sessions/artifact-image';
import { Tip } from '@/components/ui/tip';
import { PreviewImage } from './preview-image';
import { ImagePreviewDetails } from './image-preview-details';

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
            {preview?.kind === 'image' ? (
              <Tip label={artifactImageSource(preview.src)} onlyWhenTextHidden>
                <DialogDescription className="mt-1 truncate font-mono text-[11px] select-text">{artifactImageSource(preview.src)}</DialogDescription>
              </Tip>
            ) : <DialogDescription className="sr-only">Interactive HTML preview</DialogDescription>}
          </div>
          <div className="min-h-0 flex-1">
            {preview?.kind === 'html' && <HtmlView key={`${preview.sessionId}:${preview.path}`} source={sessionFolder(preview.sessionId)} path={preview.path} />}
            {preview?.kind === 'image' && <ImageLightbox key={preview.src} src={preview.src} name={preview.name} alt={preview.alt} />}
          </div>
        </DialogContent>
      </Dialog>
    </ArtifactPreviewContext.Provider>
  );
}

function ImageLightbox({ src, name, alt }: { src: string; name: string; alt: string }) {
  const [error, setError] = useState<string>();
  return (
    <Tip label={<ImagePreviewDetails src={src} name={name} alt={alt} error={error} />}>
      <div className="h-full w-full">
        <PreviewImage src={src} alt={alt || name} onErrorChange={setError} className="h-full w-full object-contain p-3" />
      </div>
    </Tip>
  );
}

export function useArtifactPreview() {
  const open = useContext(ArtifactPreviewContext);
  if (!open) throw new Error('useArtifactPreview must be used within ArtifactPreviewProvider');
  return open;
}
