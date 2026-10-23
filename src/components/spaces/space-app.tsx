'use client';

import { Suspense } from 'react';
import { TeamHome } from '@/components/home/team-home';

/**
 * A team's shared work inside My Ri (docs/homes-spec.md §3.2, P7.1): the same
 * shell its members use in the team's own app, its calls going to the team
 * through this home as this person's member.
 */
export function SpaceApp() {
  return (
    <Suspense fallback={null}>
      <TeamHome />
    </Suspense>
  );
}
