import { connection } from 'next/server';
import { isTeamAuthority } from '@/lib/home/authority';

/**
 * Whether the page being rendered belongs to a team space. Read per request,
 * never from a build-time snapshot: one build serves personal homes and teams
 * (docs/homes-spec.md §9.1). A team mark beside a personal home renders the
 * personal app, whose every request the proxy refuses with the reason.
 */
export async function isTeamPage(): Promise<boolean> {
  await connection();
  try {
    return isTeamAuthority();
  } catch {
    return false;
  }
}
