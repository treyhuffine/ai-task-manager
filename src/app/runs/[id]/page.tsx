'use client';

/**
 * Minimal run detail view at /runs/<id>. Covers the failure-banner
 * "view last failed run" link plus a generic landing for CLI URLs. The
 * full transcript lives at the chat session — when the run has a chat,
 * we offer a deep link to it.
 */

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { runsApi } from '@/lib/api/schedules';
import type { RunRecord } from '@/db/types';

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const { data: run, isLoading } = useQuery<RunRecord>({
    queryKey: ['run', id],
    queryFn: () => runsApi.get(id!),
    enabled: !!id,
  });

  if (isLoading || !run) {
    return (
      <div className="min-h-dvh bg-background text-foreground flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground font-sans">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3 sticky top-0 bg-background z-10">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">Run {run.id.slice(0, 8)}</h1>
          <p className="text-[11px] text-muted-foreground">
            trigger={run.trigger} · status={run.status}
          </p>
        </div>
        {run.chatSessionId && (
          <Link
            href={`/?session=${run.chatSessionId}`}
            className="px-3 py-1.5 rounded-md text-sm border border-border bg-card hover:bg-muted"
          >
            Open chat
          </Link>
        )}
      </header>

      <main className="px-6 py-6 max-w-3xl mx-auto space-y-4">
        {run.errorMessage && (
          <section className="p-3 rounded-md border border-destructive/30 bg-destructive/10">
            <p className="text-[11px] uppercase tracking-wider text-destructive">
              Error
            </p>
            <p className="text-sm text-destructive font-mono mt-1 whitespace-pre-wrap">
              {run.errorMessage}
            </p>
            {run.errorCode && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Code: <code className="font-mono">{run.errorCode}</code>
              </p>
            )}
          </section>
        )}

        {run.summary && (
          <section>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Summary
            </p>
            <p className="text-sm mt-1">{run.summary}</p>
          </section>
        )}

        <section className="text-[12px] text-muted-foreground space-y-1">
          {run.startedAt && <p>Started: {run.startedAt}</p>}
          {run.completedAt && <p>Completed: {run.completedAt}</p>}
          {run.durationMs != null && <p>Duration: {Math.round(run.durationMs / 1000)}s</p>}
          {run.model && <p>Model: {run.model}</p>}
          {run.costUsd != null && <p>Cost: ${(run.costUsd ?? 0).toFixed(6)}</p>}
          {run.inputTokens != null && (
            <p>
              Tokens: in {run.inputTokens?.toLocaleString()} / out{' '}
              {run.outputTokens?.toLocaleString()} / cached{' '}
              {run.cachedInputTokens?.toLocaleString()}
            </p>
          )}
        </section>

        {Array.isArray(run.artifactRefs) && run.artifactRefs.length > 0 && (
          <section>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Artifacts produced
            </p>
            <ul className="text-sm space-y-0.5">
              {run.artifactRefs.map((ref, i) => (
                <li key={i} className="font-mono text-[12px]">
                  {ref.kind}: {ref.id}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
