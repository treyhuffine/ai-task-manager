import { redirect } from 'next/navigation';
import { TeamJoin } from '@/components/team/team-join';
import { isTeamPage } from '@/lib/team/page-authority';

export const dynamic = 'force-dynamic';

/**
 * A team link's landing: an invitation, a sign-in link for another device, or
 * an operator's setup link, each carried in the fragment
 * (src/lib/team/links.ts). Only a team has one.
 */
export default async function Join() {
  if (!(await isTeamPage())) redirect('/');
  return <TeamJoin />;
}
