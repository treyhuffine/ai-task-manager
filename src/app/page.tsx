import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/dashboard/dashboard';
import { getUserState } from '@/lib/db/queries';

export default function Home() {
  const state = getUserState();
  if (!state?.onboarded_at) {
    redirect('/welcome');
  }
  return <Dashboard />;
}
