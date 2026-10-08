'use client';

import Link from 'next/link';
import { FileCheck2 } from 'lucide-react';
import { useResultCapabilities, useResults } from '@/hooks/use-results';

export function ExecutionResultsShortcut({ executionId }: { executionId: string }) {
  const capabilities = useResultCapabilities();
  const retained = useResults({ executionId, includeSuperseded: true, limit: 1 });
  if (!capabilities.data?.handoffsEnabled && !retained.data?.length) return null;
  return <Link href={`/results?executionId=${encodeURIComponent(executionId)}`} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Saved results for this execution"><FileCheck2 size={14} /><span className="hidden sm:inline">Results</span></Link>;
}
