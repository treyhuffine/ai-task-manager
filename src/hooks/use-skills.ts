import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { skillsApi, type MoveSkillBody, type SaveSkillBody, type SkillView } from '@/lib/api/skills';

export const SKILLS_KEY = ['skills'] as const;
export const skillKey = (ref: string) => [...SKILLS_KEY, 'one', ref] as const;
const OVERVIEW_KEY = [...SKILLS_KEY, 'overview'] as const;

/** Every skill: Ri's, the global ones, and each project's (docs/skills.md). */
export function useSkills() {
  return useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: () => skillsApi.overview(),
    staleTime: 10_000,
  });
}

/**
 * One skill. `live` polls while the builder AI may be writing, so its edits
 * show up as they land rather than only when its turn ends.
 */
export function useSkill(ref: string | null, opts: { live?: boolean } = {}) {
  return useQuery({
    queryKey: skillKey(ref ?? ''),
    queryFn: () => skillsApi.get(ref!).then((r) => r.skill),
    enabled: !!ref,
    staleTime: 2_000,
    refetchInterval: opts.live ? 1_500 : false,
    retry: (count, err) => !(err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) && count < 2,
  });
}

function useSettle() {
  const qc = useQueryClient();
  return (skill?: SkillView) => {
    if (skill) qc.setQueryData(skillKey(skill.ref), skill);
    return qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
  };
}

export function useSaveSkill(ref: string) {
  const settle = useSettle();
  return useMutation({
    mutationFn: (body: SaveSkillBody) => skillsApi.save(ref, body),
    onSuccess: (result) => settle(result.skill),
  });
}

export function useMoveSkill(ref: string) {
  const settle = useSettle();
  return useMutation({
    mutationFn: (body: MoveSkillBody) => skillsApi.move(ref, body),
    onSuccess: (result) => settle(result.skill),
  });
}

export function useCommitSkill(ref: string) {
  const settle = useSettle();
  return useMutation({
    mutationFn: () => skillsApi.commit(ref),
    onSuccess: (result) => settle(result.skill),
  });
}

export function useArchiveSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ref: string) => skillsApi.archive(ref),
    onSuccess: (_result, ref) => {
      qc.removeQueries({ queryKey: skillKey(ref) });
      return qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
    },
  });
}
