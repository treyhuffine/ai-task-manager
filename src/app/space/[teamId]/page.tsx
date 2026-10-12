import { notFound } from 'next/navigation';
import { isTeamPage } from '@/lib/team/page-authority';
import { SpaceApp } from '@/components/spaces/space-app';

/** A team's space inside My Ri (docs/homes-spec.md §3.2, P7.1). A team itself has none. */
export default async function SpacePage() {
  if (await isTeamPage()) notFound();
  return <SpaceApp />;
}
