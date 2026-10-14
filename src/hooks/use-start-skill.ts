'use client';

import { toast } from 'sonner';
import { useCreateSkill } from '@/hooks/use-skills';
import { useDashboard } from '@/contexts/dashboard-context';
import { closeSettings } from '@/components/settings/settings-store';
import { apiErrorText } from '@/lib/api/client';

/** Every New skill entry starts the same reusable blank draft and opens its builder. */
export function useStartSkill() {
  const create = useCreateSkill();
  const { openSkill } = useDashboard();
  return {
    isPending: create.isPending,
    start: () => create.mutate({}, {
      onSuccess: ({ skill }) => { closeSettings(); openSkill(skill.ref); },
      onError: error => toast.error(apiErrorText(error)),
    }),
  };
}
