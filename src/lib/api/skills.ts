import { api } from './client';
import type { SkillsOverview, SkillView, SaveSkillResult } from '@/lib/skills/manage';
import type { SkillReach } from '@/lib/skills/reach';
import type { SupportingFileWrite } from '@/lib/skills/library';

export type { SkillsOverview, SkillView, SaveSkillResult, SkillReach };
export type { SkillSummary } from '@/lib/skills/manage';
export type { OutsideSkill } from '@/lib/skills/outside';
export type { SkillProblem } from '@/lib/skills/format';

export interface CreateSkillBody {
  name?: string;
  intent?: string;
  description?: string;
  body?: string;
}

export interface SaveSkillBody {
  newName?: string;
  description?: string;
  body?: string;
  content?: string;
  files?: SupportingFileWrite[];
  baseHash?: string | null;
}

/** The skill library (docs/skills.md). */
export const skillsApi = {
  /** With `workspaceId`, also that agent's folder skills. */
  overview(workspaceId?: string): Promise<SkillsOverview> {
    return api.get<SkillsOverview>('/skills', { query: workspaceId ? { workspaceId } : undefined });
  },

  get(name: string): Promise<{ skill: SkillView }> {
    return api.get<{ skill: SkillView }>(`/skills/${encodeURIComponent(name)}`);
  },

  /** A new skill, off. Named from `intent` when `name` is absent. */
  create(body: CreateSkillBody): Promise<{ skill: SkillView }> {
    return api.post<{ skill: SkillView }>('/skills', body);
  },

  /** 409 with `{ code: 'stale', current }` when `baseHash` is behind. */
  save(name: string, body: SaveSkillBody): Promise<SaveSkillResult> {
    return api.put<SaveSkillResult>(`/skills/${encodeURIComponent(name)}`, body);
  },

  archive(name: string): Promise<{ archivedTo: string }> {
    return api.delete<{ archivedTo: string }>(`/skills/${encodeURIComponent(name)}`);
  },

  setReach(name: string, reach: SkillReach): Promise<{ skill: SkillView }> {
    return api.put<{ skill: SkillView }>(`/skills/${encodeURIComponent(name)}/reach`, reach);
  },

  importOutside(name: string): Promise<{ skill: SkillView }> {
    return api.post<{ skill: SkillView }>('/skills/outside/import', { name });
  },
};
