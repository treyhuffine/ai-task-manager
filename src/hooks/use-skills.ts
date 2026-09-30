import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { skillsApi, type SaveSkillBody, type SkillReach, type SkillView } from '@/lib/api/skills';

export const SKILLS_KEY = ['skills'] as const;
const skillKey = (name: string) => [...SKILLS_KEY, 'one', name] as const;

/**
 * Every library skill with its reach, plus skills outside Ri (docs/skills.md).
 * With a workspace, also the skills in that agent's own folder.
 */
export function useSkills(workspaceId?: string) {
  return useQuery({
    queryKey: [...SKILLS_KEY, 'overview', workspaceId ?? null],
    queryFn: () => skillsApi.overview(workspaceId),
    staleTime: 10_000,
  });
}

/**
 * One skill. `live` polls while the builder AI may be writing, so its edits
 * show up as they land rather than only when its turn ends.
 */
export function useSkill(name: string | null, opts: { live?: boolean } = {}) {
  return useQuery({
    queryKey: skillKey(name ?? ''),
    queryFn: () => skillsApi.get(name!).then((r) => r.skill),
    enabled: !!name,
    staleTime: 2_000,
    refetchInterval: opts.live ? 1_500 : false,
    retry: (count, err) => !(err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) && count < 2,
  });
}

function useInvalidateSkills() {
  const qc = useQueryClient();
  return (skill?: SkillView) => {
    if (skill) qc.setQueryData(skillKey(skill.name), skill);
    return qc.invalidateQueries({ queryKey: [...SKILLS_KEY, 'overview'] });
  };
}

export function useSaveSkill(name: string) {
  const invalidate = useInvalidateSkills();
  return useMutation({
    mutationFn: (body: SaveSkillBody) => skillsApi.save(name, body),
    onSuccess: (result) => invalidate(result.skill),
  });
}

export function useSetSkillReach(name: string) {
  const invalidate = useInvalidateSkills();
  return useMutation({
    mutationFn: (reach: SkillReach) => skillsApi.setReach(name, reach),
    onSuccess: (result) => invalidate(result.skill),
  });
}

export function useArchiveSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => skillsApi.archive(name),
    onSuccess: (_result, name) => {
      qc.removeQueries({ queryKey: skillKey(name) });
      return qc.invalidateQueries({ queryKey: [...SKILLS_KEY, 'overview'] });
    },
  });
}

export function useImportSkill() {
  const invalidate = useInvalidateSkills();
  return useMutation({
    mutationFn: (name: string) => skillsApi.importOutside(name),
    onSuccess: (result) => invalidate(result.skill),
  });
}
