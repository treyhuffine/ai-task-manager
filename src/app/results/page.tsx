'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ResultList } from '@/components/results/result-list';

function SavedResultsPage() {
  const params = useSearchParams();
  const taskId = params.get('taskId') || undefined;
  const executionId = params.get('executionId') || undefined;
  const scope = taskId ? 'task' : executionId ? 'execution' : 'all';
  return <main className="min-h-dvh bg-background text-foreground">
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={13} />Return to Ri</Link>
      <div className="space-y-1"><h1 className="text-xl font-semibold">Saved results</h1><p className="text-sm text-muted-foreground">{scope === 'all' ? 'Find saved handoffs and their earlier versions.' : `Saved handoffs linked to this ${scope}.`}</p>{scope !== 'all' && <Link href="/results" className="inline-block text-xs text-primary hover:underline">All saved results</Link>}</div>
      <ResultList key={`${taskId ?? ''}:${executionId ?? ''}`} taskId={taskId} executionId={executionId} />
    </div>
  </main>;
}

export default function ResultsPage() {
  return <Suspense fallback={<main className="p-6 text-sm text-muted-foreground">Loading saved results</main>}><SavedResultsPage /></Suspense>;
}
