'use client';

import Link from 'next/link';
import { ClipboardCheck } from 'lucide-react';
import { useRailSessions } from '@/hooks/use-workspaces';

export function MobileReviewAttention() {
  const { data: rail } = useRailSessions();
  const reviews = rail?.resultReviewAttention ?? [];
  if (!reviews.length) return null;
  return <section className="border-b border-border/60 px-3 pb-2 pt-3">
    <div className="flex items-center gap-2 px-1.5 pb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground"><ClipboardCheck size={12} />AI review activity</div>
    <div className="space-y-1">{reviews.map((review) => <Link key={review.reviewId} href={`/results/${review.resultId}`} className="block min-h-11 rounded-lg px-3 py-2 active:bg-muted/40">
      <p className="truncate text-[13px] font-medium">{review.label ?? 'AI review'}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{rail?.pendingSessionIds.includes(review.sessionId) ? 'Needs your response' : review.statusReason?.replaceAll('_', ' ') ?? (review.status === 'running' ? 'Reviewing with AI' : review.status === 'queued' ? 'Queued' : 'Review failed')}</p>
    </Link>)}</div>
  </section>;
}
