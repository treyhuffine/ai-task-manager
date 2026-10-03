import { Dashboard } from '@/components/dashboard/dashboard';

// Dynamic so the dashboard is never served from a build-time snapshot.
export const dynamic = 'force-dynamic';

/**
 * Home. A new home opens here too: first-run setup is a conversation in the
 * main chat, not a wizard in front of the app (docs/main-chat-onboarding.md).
 */
export default function Home() {
  return <Dashboard />;
}
