import { redirect } from 'next/navigation';
import { getUserState } from '@/lib/db/queries';
import { Wizard } from './_components/wizard';

// Same reason as `/` — gating reads `onboarded_at` at request time, not build time.
export const dynamic = 'force-dynamic';

// Bounce already-onboarded users back to the dashboard unless they pass
// `?force=1` — lets us re-run the wizard on demand without clearing the DB.
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ force?: string }>;
}) {
  const { force } = await searchParams;
  const state = getUserState();
  if (state?.onboarded_at && !force) {
    redirect('/');
  }
  return <Wizard />;
}
