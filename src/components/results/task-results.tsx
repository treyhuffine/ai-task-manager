'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useResults } from '@/hooks/use-results';
import { apiErrorText } from '@/lib/api/client';
import { ResultList, ResultListItem } from './result-list';

/** Read-only saved records belong outside the editable task document. */
export function TaskResults({ taskId }: { taskId: string }) {
  const current = useResults({ taskId, limit: 5 });
  const history = useResults({ taskId, includeSuperseded: true, limit: 1 });
  const [expanded, setExpanded] = useState(false);
  if (!current.error && !history.error && !current.data?.length && !history.data?.length) return null;
  return <section aria-label="Task results" className="space-y-3 border-t pt-4 pb-6">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-xs font-semibold">Results</h2>
      <Link href={`/results?taskId=${encodeURIComponent(taskId)}`} className="text-xs text-muted-foreground hover:text-foreground">All saved results</Link>
    </div>
    {(current.error || history.error) && <p role="alert" className="text-xs text-destructive">{apiErrorText(current.error ?? history.error)}</p>}
    {!expanded && current.data?.map((result) => <ResultListItem key={result.id} result={result} compact />)}
    {!expanded && !current.data?.length && !!history.data?.length && <p className="text-xs text-muted-foreground">Earlier saved snapshots are available.</p>}
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="text-xs text-muted-foreground hover:text-foreground">{expanded ? 'Hide result history' : 'Show result history'}</button>
    {expanded && <ResultList taskId={taskId} compact initialHistory />}
  </section>;
}
