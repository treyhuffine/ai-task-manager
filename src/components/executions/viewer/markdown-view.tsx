'use client';

import { Loader2, FileX, FileWarning, Lock } from 'lucide-react';
import { useSessionFile } from '@/hooks/use-execution';
import { MessageResponse } from '@/components/ai-elements/message';

interface MarkdownViewProps {
  sessionId: string;
  path: string;
}

/**
 * Read-only rendered view for markdown files. Same source-of-truth hook
 * as the plain editor, just piped through Streamdown for a document-
 * styled render. Editing always happens in Current mode — Render is a
 * read affordance, not a WYSIWYG.
 */
export function MarkdownView({ sessionId, path }: MarkdownViewProps) {
  const { data, isLoading, error } = useSessionFile(sessionId, path);

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<FileX size={18} className="text-muted-foreground/70" />}
        title="Couldn't load this file"
        detail={error instanceof Error ? error.message : 'Unknown error'}
      />
    );
  }

  if (!data) return null;

  if (data.tooLarge) {
    return (
      <EmptyState
        icon={<FileWarning size={18} className="text-amber-500" />}
        title="File too large to render"
        detail={`${formatBytes(data.size)} exceeds the 1 MiB preview cap.`}
      />
    );
  }

  if (data.isBinary) {
    return (
      <EmptyState
        icon={<Lock size={18} className="text-muted-foreground/70" />}
        title="Binary file"
        detail={`${data.mime} · ${formatBytes(data.size)}`}
      />
    );
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto max-w-3xl px-6 py-6 text-[14px] leading-relaxed text-foreground/90">
        <MessageResponse className="markdown-doc !size-auto">
          {data.content ?? ''}
        </MessageResponse>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center text-[11px] text-muted-foreground/80">
      {icon}
      <span className="text-foreground/85 text-[12px] font-medium">{title}</span>
      {detail && <span className="text-muted-foreground/70">{detail}</span>}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}
