/**
 * The `linear` toolkit. Linear is GraphQL-only, so every action POSTs to `/graphql` with a
 * `query` + `variables` body and maps `data.*` in its output. A GraphQL `errors` array is
 * surfaced as a `provider_error` (HTTP-200-with-errors is Linear's failure mode).
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { ConnectorError } from '../../core/errors';

interface GraphQLResp {
  data?: Record<string, unknown>;
  errors?: Array<{ message?: string }>;
}

/** Unwrap a GraphQL response, throwing on `errors`. */
function data(raw: unknown): Record<string, unknown> {
  const r = raw as GraphQLResp;
  if (r.errors?.length) throw new ConnectorError('provider_error', `linear: ${r.errors[0]?.message ?? 'graphql error'}`);
  return r.data ?? {};
}

export const linearToolkit = defineToolkit({
  id: 'linear',
  providerId: 'linear',
  displayName: 'Linear',
  actions: [
    httpAction({
      id: 'linear.list_issues',
      description: 'List issues, most recent first. Optionally filter by a title substring.',
      scopes: ['read'],
      input: z.object({
        first: z.number().int().positive().max(50).default(25),
        query: z.string().optional().describe('Title substring to filter on'),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/graphql',
        body: {
          query: i.query
            ? 'query($first:Int!,$q:String!){ issues(first:$first, filter:{ title:{ containsIgnoreCase:$q } }){ nodes { id identifier title state { name } assignee { name } } } }'
            : 'query($first:Int!){ issues(first:$first){ nodes { id identifier title state { name } assignee { name } } } }',
          variables: i.query ? { first: i.first, q: i.query } : { first: i.first },
        },
      }),
      output: (raw) => {
        const issues = data(raw).issues as { nodes?: unknown[] } | undefined;
        return { issues: issues?.nodes ?? [] };
      },
    }),

    httpAction({
      id: 'linear.create_issue',
      description: 'Create an issue on a team.',
      mutating: true,
      risk: 'medium',
      scopes: ['issues:create'],
      input: z.object({
        teamId: z.string(),
        title: z.string(),
        description: z.string().optional(),
        priority: z.number().int().min(0).max(4).optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/graphql',
        body: {
          query: 'mutation($input:IssueCreateInput!){ issueCreate(input:$input){ success issue { id identifier url } } }',
          variables: {
            input: {
              teamId: i.teamId,
              title: i.title,
              ...(i.description !== undefined ? { description: i.description } : {}),
              ...(i.priority !== undefined ? { priority: i.priority } : {}),
            },
          },
        },
      }),
      output: (raw) => (data(raw).issueCreate as { issue?: unknown })?.issue ?? null,
    }),

    httpAction({
      id: 'linear.update_issue',
      description: 'Update fields on an existing issue.',
      mutating: true,
      risk: 'medium',
      scopes: ['write'],
      input: z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        stateId: z.string().optional(),
        priority: z.number().int().min(0).max(4).optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/graphql',
        body: {
          query: 'mutation($id:String!,$input:IssueUpdateInput!){ issueUpdate(id:$id, input:$input){ success issue { id identifier } } }',
          variables: {
            id: i.id,
            input: {
              ...(i.title !== undefined ? { title: i.title } : {}),
              ...(i.description !== undefined ? { description: i.description } : {}),
              ...(i.stateId !== undefined ? { stateId: i.stateId } : {}),
              ...(i.priority !== undefined ? { priority: i.priority } : {}),
            },
          },
        },
      }),
      output: (raw) => (data(raw).issueUpdate as { issue?: unknown })?.issue ?? null,
    }),

    httpAction({
      id: 'linear.add_comment',
      description: 'Add a comment to an issue.',
      mutating: true,
      risk: 'low',
      scopes: ['write'],
      input: z.object({ issueId: z.string(), body: z.string() }),
      request: (i) => ({
        method: 'POST',
        path: '/graphql',
        body: {
          query: 'mutation($input:CommentCreateInput!){ commentCreate(input:$input){ success comment { id } } }',
          variables: { input: { issueId: i.issueId, body: i.body } },
        },
      }),
      output: (raw) => (data(raw).commentCreate as { comment?: unknown })?.comment ?? null,
    }),

    httpAction({
      id: 'linear.list_teams',
      description: 'List the teams the user can access.',
      scopes: ['read'],
      input: z.object({}),
      request: () => ({ method: 'POST', path: '/graphql', body: { query: '{ teams { nodes { id name key } } }' } }),
      output: (raw) => ({ teams: (data(raw).teams as { nodes?: unknown[] } | undefined)?.nodes ?? [] }),
    }),

    httpAction({
      id: 'linear.list_projects',
      description: 'List projects.',
      scopes: ['read'],
      input: z.object({}),
      request: () => ({ method: 'POST', path: '/graphql', body: { query: '{ projects { nodes { id name state } } }' } }),
      output: (raw) => ({ projects: (data(raw).projects as { nodes?: unknown[] } | undefined)?.nodes ?? [] }),
    }),
  ],
});
