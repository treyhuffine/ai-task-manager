'use client';

import { toast } from 'sonner';
import { useCreateSkill } from '@/hooks/use-skills';
import { useSkillNavigation } from '@/components/skills/skill-navigation';
import { apiErrorText } from '@/lib/api/client';

/** Every New skill entry starts the same reusable blank draft and opens its builder. */
export function useStartSkill() {
  const create = useCreateSkill();
  const { openSkill, closeCatalog } = useSkillNavigation();
  return {
    isPending: create.isPending,
    start: () => create.mutate({}, {
      onSuccess: ({ skill }) => { closeCatalog(); openSkill(skill.ref); },
      onError: error => toast.error(apiErrorText(error)),
    }),
  };
}
