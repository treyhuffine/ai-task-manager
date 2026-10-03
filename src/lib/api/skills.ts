import type { SkillCommit } from '@/lib/skills/git';
import type { SaveSkillResult, SkillsOverview, SkillView } from '@/lib/skills/manage';
import { trpcClient } from '@/lib/trpc/client';
import type { RouterInputs } from '@/lib/trpc/router';

export type { SkillProblem } from '@/lib/skills/format';
export type { ProjectInfo } from '@/lib/skills/locations';
export type { SkillLocationView, SkillSummary } from '@/lib/skills/manage';
export type { SaveSkillResult, SkillCommit, SkillsOverview, SkillView };

export type LocationKind = 'draft' | 'ri' | 'global' | 'project';

export type CreateSkillBody = RouterInputs['skills']['create']['body'];

export type SaveSkillBody = RouterInputs['skills']['RefPut']['body'];

export type MoveSkillBody = RouterInputs['skills']['moveRefPost']['body'];


/** Skills, wherever they live (docs/skills.md). */
export const skillsApi = {
  overview() {
    return trpcClient.skills.list.query({});
  },

  get(ref: string) {
    return trpcClient.skills.RefGet.query({ params: { ref } });
  },

  /**
   * A new skill, a draft unless a location installs it. Named from `intent`
   * when `name` is absent. An empty body hands back a blank, unused draft if
   * there is one.
   */
  create(body: CreateSkillBody) {
    return trpcClient.skills.create.mutate({body: body});
  },

  /** 409 with `{ code: 'stale', current }` when `baseHash` is behind. */
  save(ref: string, body: SaveSkillBody) {
    return trpcClient.skills.RefPut.mutate({ params: { ref }, body });
  },

  archive(ref: string) {
    return trpcClient.skills.RefDelete.mutate({ params: { ref } });
  },

  move(ref: string, body: MoveSkillBody) {
    return trpcClient.skills.moveRefPost.mutate({ params: { ref }, body });
  },

  /** Commit a project skill's files in its repo. */
  commit(ref: string) {
    return trpcClient.skills.commitRefPost.mutate({ params: { ref } });
  },
};
