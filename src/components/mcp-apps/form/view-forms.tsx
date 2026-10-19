'use client';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import { ConnectedForm } from './connected-form';

/**
 * Forms an app view's own calls asked for, shown over that view. Checked
 * every 1.5 seconds while the view is open: a lookup in the Home's memory,
 * which a form needs to appear while the app waits on it.
 */
export function ConnectedViewForms({viewId}: {viewId: string}) {
  const query = useQuery(trpc.connectedApps.forms.forView.queryOptions({viewId}, {refetchInterval: 1500, retry: false}));
  const formId = query.data?.[0];
  if (!formId) return null;
  return <div className="absolute inset-0 z-10 flex items-start justify-center overflow-auto bg-background/70 p-4 backdrop-blur-sm">
    <div className="w-full max-w-lg rounded-xl border border-border bg-background p-4 shadow-lg">
      <ConnectedForm key={formId} formId={formId} bare />
    </div>
  </div>;
}
