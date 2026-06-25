/**
 * The `gitlab` toolkit. Non-OAuth (PAT) → no action `scopes`. Project ids may be a numeric id
 * or a url-encoded `group/repo` path, so path ids are `encodeURIComponent`'d.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

const projectId = z.union([z.string(), z.number()]);

interface RawProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
}
interface RawIssue {
  id: number;
  iid: number;
  title: string;
  state: string;
  web_url: string;
}

export const gitlabToolkit = defineToolkit({
  id: 'gitlab',
  providerId: 'gitlab',
  displayName: 'GitLab',
  actions: [
    httpAction({
      id: 'gitlab.list_projects',
      description: 'List projects the authenticated user is a member of.',
      input: z.object({ perPage: z.number().int().positive().max(100).default(20) }),
      request: (i) => ({ method: 'GET', path: '/projects', query: { membership: true, per_page: i.perPage } }),
      output: (raw) => {
        const r = (raw as RawProject[]) ?? [];
        return { projects: r.map((p) => ({ id: p.id, name: p.name, path: p.path_with_namespace, webUrl: p.web_url })) };
      },
    }),

    httpAction({
      id: 'gitlab.list_issues',
      description: 'List issues across the user’s projects.',
      input: z.object({
        state: z.enum(['opened', 'closed', 'all']).default('opened'),
        perPage: z.number().int().positive().max(100).default(20),
      }),
      request: (i) => ({ method: 'GET', path: '/issues', query: { state: i.state, per_page: i.perPage } }),
      output: (raw) => {
        const r = (raw as RawIssue[]) ?? [];
        return { issues: r.map((x) => ({ id: x.id, iid: x.iid, title: x.title, state: x.state, webUrl: x.web_url })) };
      },
    }),

    httpAction({
      id: 'gitlab.get_project',
      description: 'Get a project by numeric id or url-encoded `group/repo` path.',
      input: z.object({ id: projectId }),
      request: (i) => ({ method: 'GET', path: `/projects/${encodeURIComponent(String(i.id))}` }),
      output: (raw) => {
        const p = raw as RawProject;
        return { id: p.id, name: p.name, path: p.path_with_namespace, webUrl: p.web_url };
      },
    }),

    httpAction({
      id: 'gitlab.create_issue',
      description: 'Create an issue in a project.',
      mutating: true,
      risk: 'medium',
      input: z.object({ id: projectId, title: z.string(), description: z.string().optional() }),
      request: (i) => ({
        method: 'POST',
        path: `/projects/${encodeURIComponent(String(i.id))}/issues`,
        body: { title: i.title, description: i.description },
      }),
      output: (raw) => {
        const x = raw as RawIssue;
        return { id: x.id, iid: x.iid, webUrl: x.web_url };
      },
    }),

    httpAction({
      id: 'gitlab.list_merge_requests',
      description: 'List merge requests across the user’s projects.',
      input: z.object({
        state: z.enum(['opened', 'closed', 'merged', 'all']).default('opened'),
        perPage: z.number().int().positive().max(100).default(20),
      }),
      request: (i) => ({ method: 'GET', path: '/merge_requests', query: { state: i.state, per_page: i.perPage } }),
      output: (raw) => {
        const r = (raw as RawIssue[]) ?? [];
        return { mergeRequests: r.map((x) => ({ id: x.id, iid: x.iid, title: x.title, state: x.state, webUrl: x.web_url })) };
      },
    }),
  ],
});
