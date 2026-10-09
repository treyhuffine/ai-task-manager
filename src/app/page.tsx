import { Dashboard } from '@/components/dashboard/dashboard';
import { TeamApp } from '@/components/team/team-app';
import { isTeamPage } from '@/lib/team/page-authority';

// Dynamic so the dashboard is never served from a build-time snapshot.
export const dynamic = 'force-dynamic';

/**
 * Home. A new home opens here too: first-run setup is a conversation in the
 * main chat, not a wizard in front of the app (docs/main-chat-onboarding.md).
 * A team space opens on its shared work instead (docs/homes-spec.md §3.2).
 */
export default async function Home() {
  return (await isTeamPage()) ? <TeamApp /> : <Dashboard />;
}
