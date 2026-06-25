/**
 * The `jira` toolkit. The site (`cloudId`) is captured on the connection at connect (see
 * provider.ts identify) and read from `ctx.config` in each action's `request(input, { config })`
 * — so it's NEVER on the action input (the agent never carries a site id). Each action builds an
 * ABSOLUTE Jira Cloud REST v3 URL; rich text uses Atlassian Document Format (ADF).
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

const SCOPE = { read: 'read:jira-work', write: 'write:jira-work' } as const;

/** Per-site Jira Cloud REST v3 base, from the connection's stored cloudId. */
function base(config: Record<string, unknown>): string {
  return `https://api.atlassian.com/ex/jira/${encodeURIComponent(String(config.cloudId))}/rest/api/3`;
}

/** Minimal Atlassian Document Format wrapper for a plain-text body. */
function adf(text: string) {
  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

interface RawIssue {
  id?: string;
  key?: string;
  fields?: { summary?: string; status?: { name?: string } };
}

export const jiraToolkit = defineToolkit({
  id: 'jira',
  providerId: 'jira',
  displayName: 'Jira',
  actions: [
    httpAction({
      id: 'jira.search_issues',
      description: 'Search Jira issues with a JQL query.',
      scopes: [SCOPE.read],
      input: z.object({
        jql: z.string().describe('JQL, e.g. "project = ABC AND status = \'To Do\'"'),
        maxResults: z.number().int().positive().max(100).default(25),
      }),
      request: (i, { config }) => ({
        method: 'GET',
        path: `${base(config)}/search`,
        query: { jql: i.jql, maxResults: i.maxResults },
      }),
      output: (raw) => {
        const r = raw as { total?: number; issues?: RawIssue[] };
        return {
          total: r.total,
          issues: (r.issues ?? []).map((is) => ({
            id: is.id,
            key: is.key,
            summary: is.fields?.summary,
            status: is.fields?.status?.name,
          })),
        };
      },
    }),

    httpAction({
      id: 'jira.get_issue',
      description: 'Get a single Jira issue by id or key.',
      scopes: [SCOPE.read],
      input: z.object({ issueIdOrKey: z.string() }),
      request: (i, { config }) => ({ method: 'GET', path: `${base(config)}/issue/${encodeURIComponent(i.issueIdOrKey)}` }),
      output: (raw) => {
        const r = raw as { id?: string; key?: string; fields?: Record<string, unknown> };
        return { id: r.id, key: r.key, fields: r.fields };
      },
    }),

    httpAction({
      id: 'jira.create_issue',
      description: 'Create a Jira issue.',
      mutating: true,
      risk: 'medium',
      scopes: [SCOPE.write],
      input: z.object({
        projectKey: z.string(),
        summary: z.string(),
        description: z.string().optional(),
        issueType: z.string().default('Task'),
      }),
      request: (i, { config }) => ({
        method: 'POST',
        path: `${base(config)}/issue`,
        body: {
          fields: {
            project: { key: i.projectKey },
            summary: i.summary,
            issuetype: { name: i.issueType },
            ...(i.description ? { description: adf(i.description) } : {}),
          },
        },
      }),
      output: (raw) => {
        const r = raw as { id?: string; key?: string };
        return { id: r.id, key: r.key };
      },
    }),

    httpAction({
      id: 'jira.update_issue',
      description: 'Update fields on a Jira issue (raw Jira `fields` object).',
      mutating: true,
      risk: 'medium',
      scopes: [SCOPE.write],
      input: z.object({ issueIdOrKey: z.string(), fields: z.record(z.any()) }),
      request: (i, { config }) => ({
        method: 'PUT',
        path: `${base(config)}/issue/${encodeURIComponent(i.issueIdOrKey)}`,
        body: { fields: i.fields },
      }),
      output: () => ({ updated: true }),
    }),

    httpAction({
      id: 'jira.add_comment',
      description: 'Add a comment to a Jira issue.',
      mutating: true,
      risk: 'low',
      scopes: [SCOPE.write],
      input: z.object({ issueIdOrKey: z.string(), body: z.string() }),
      request: (i, { config }) => ({
        method: 'POST',
        path: `${base(config)}/issue/${encodeURIComponent(i.issueIdOrKey)}/comment`,
        body: { body: adf(i.body) },
      }),
      output: (raw) => {
        const r = raw as { id?: string };
        return { id: r.id };
      },
    }),

    httpAction({
      id: 'jira.list_projects',
      description: 'List Jira projects on the site.',
      scopes: [SCOPE.read],
      input: z.object({}),
      request: (_i, { config }) => ({ method: 'GET', path: `${base(config)}/project/search` }),
      output: (raw) => {
        const r = raw as { values?: Array<{ id?: string; key?: string; name?: string }> };
        return { projects: (r.values ?? []).map((p) => ({ id: p.id, key: p.key, name: p.name })) };
      },
    }),
  ],
});
