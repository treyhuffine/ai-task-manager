'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ResultRenderer } from '@/components/results/result-renderer';

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center gap-4"><Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={13} />Return to Ri</Link><Link href="/results" className="text-xs text-muted-foreground hover:text-foreground">Saved results</Link></div>
        <ResultRenderer resultId={id} exact />
      </div>
    </main>
  );
}
