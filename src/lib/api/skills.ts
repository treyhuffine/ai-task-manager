import { api } from './client';
import type { SkillsOverview, SkillView, SaveSkillResult } from '@/lib/skills/manage';
import type { SkillCommit } from '@/lib/skills/git';
import type { SupportingFileWrite } from '@/lib/skills/library';

export type { SkillsOverview, SkillView, SaveSkillResult, SkillCommit };
export type { SkillSummary, SkillLocationView } from '@/lib/skills/manage';
export type { ProjectInfo } from '@/lib/skills/locations';
export type { SkillProblem } from '@/lib/skills/format';

export type LocationKind = 'ri' | 'global' | 'project';

export interface CreateSkillBody {
  name?: string;
  intent?: string;
  description?: string;
  body?: string;
  location?: LocationKind;
  workspaceId?: string;
}

export interface SaveSkillBody {
  newName?: string;
  description?: string;
  body?: string;
  content?: string;
  files?: SupportingFileWrite[];
  baseHash?: string | null;
}

export interface MoveSkillBody {
  to: LocationKind;
  workspaceId?: string;
  /** Keep the original: how a skill is shared with a project. */
  copy?: boolean;
}

const at = (ref: string) => `/skills/${encodeURIComponent(ref)}`;

/** Skills, wherever they live (docs/skills.md). */
export const skillsApi = {
  overview(): Promise<SkillsOverview> {
    return api.get<SkillsOverview>('/skills');
  },

  get(ref: string): Promise<{ skill: SkillView }> {
    return api.get<{ skill: SkillView }>(at(ref));
  },

  /** A new skill, in Ri unless a location says otherwise. Named from `intent` when `name` is absent. */
  create(body: CreateSkillBody): Promise<{ skill: SkillView }> {
    return api.post<{ skill: SkillView }>('/skills', body);
  },

  /** 409 with `{ code: 'stale', current }` when `baseHash` is behind. */
  save(ref: string, body: SaveSkillBody): Promise<SaveSkillResult> {
    return api.put<SaveSkillResult>(at(ref), body);
  },

  archive(ref: string): Promise<{ archivedTo: string }> {
    return api.delete<{ archivedTo: string }>(at(ref));
  },

  move(ref: string, body: MoveSkillBody): Promise<{ skill: SkillView }> {
    return api.post<{ skill: SkillView }>(`${at(ref)}/move`, body);
  },

  /** Commit a project skill's files in its repo. */
  commit(ref: string): Promise<{ skill: SkillView; commit: SkillCommit }> {
    return api.post<{ skill: SkillView; commit: SkillCommit }>(`${at(ref)}/commit`);
  },
};
