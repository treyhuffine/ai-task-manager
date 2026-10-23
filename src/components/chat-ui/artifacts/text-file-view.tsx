'use client';

import { useState } from 'react';
import { useFolderFile } from '@/hooks/use-folder';
import { sessionFolder } from '@/lib/folders/source';
import { AgentResponse } from '@/components/chat-ui/messages/agent-response';
import { Button } from '@/components/ui/button';
import { FileSkeleton } from '@/components/executions/skeletons';

/** Read only. Markdown starts rendered, and source remains available for every text format. */
export function TextFileView({ sessionId, path }: { sessionId: string; path: string }) {
  const { data, isPending, error } = useFolderFile(sessionFolder(sessionId), path);
  const [source, setSource] = useState(false);
  const markdown = /\.(md|mdx|markdown)$/i.test(path);
  if (isPending && !data) return <FileSkeleton variant="prose" />;
  const message = error ? (error instanceof Error ? error.message : 'Could not load this file')
    : data?.tooLarge ? 'This file exceeds the 1 MiB preview limit.'
      : data?.isBinary ? 'This file contains binary data and cannot be shown as text.' : null;
  if (message) return <p role="status" className="p-6 text-sm text-muted-foreground">{message}</p>;
  if (!data) return null;
  return <div className="flex h-full min-h-0 flex-col bg-background">
    {markdown && <div role="group" aria-label="Document view" className="flex shrink-0 gap-1 border-b border-border px-3 py-1.5">
      <Button size="xs" variant="ghost" aria-pressed={!source} onClick={() => setSource(false)}>Rendered</Button>
      <Button size="xs" variant="ghost" aria-pressed={source} onClick={() => setSource(true)}>Source</Button>
    </div>}
    <div className="min-h-0 flex-1 overflow-auto">
      {markdown && !source
        ? <div className="mx-auto max-w-3xl px-6 py-6 text-sm leading-relaxed"><AgentResponse mode="static" text={data.content ?? ''} sessionId={sessionId} fileBasePath={path} /></div>
        : <pre tabIndex={0} aria-label="File source" className="min-h-full whitespace-pre p-4 font-mono text-xs leading-relaxed select-text">{data.content ?? ''}</pre>}
    </div>
  </div>;
}
