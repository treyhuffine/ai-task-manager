import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/dashboard/dashboard';
import { getUserState } from '@/lib/db/queries';

// Gating depends on a runtime DB read (onboarded_at). Prerendering this page
// caches the redirect decision against whatever the DB looked like at build
// time, which produces an infinite /welcome ↔ / loop after onboarding.
export const dynamic = 'force-dynamic';

export default function Home() {
  const state = getUserState();
  if (!state?.onboarded_at) {
    redirect('/welcome');
  }
  return <Dashboard />;
}
