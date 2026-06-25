/**
 * The `airtable` toolkit — bases + records via the Airtable Web API. Non-OAuth provider, so
 * actions carry no `scopes` (a token's grants are fixed at creation, not per-call).
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

interface RawRecord {
  id?: string;
  fields?: Record<string, unknown>;
  createdTime?: string;
}

function recordSummary(r: RawRecord) {
  return { id: r.id, fields: r.fields ?? {}, createdTime: r.createdTime };
}

export const airtableToolkit = defineToolkit({
  id: 'airtable',
  providerId: 'airtable',
  displayName: 'Airtable',
  actions: [
    httpAction({
      id: 'airtable.list_bases',
      description: 'List the Airtable bases the token can access.',
      input: z.object({}),
      request: () => ({ method: 'GET', path: '/meta/bases' }),
      output: (raw) => {
        const r = raw as { bases?: Array<{ id?: string; name?: string; permissionLevel?: string }> };
        return { bases: (r.bases ?? []).map((b) => ({ id: b.id, name: b.name, permissionLevel: b.permissionLevel })) };
      },
    }),

    httpAction({
      id: 'airtable.list_records',
      description: 'List records in a table. Optionally filter with a formula or pick a view.',
      input: z.object({
        baseId: z.string(),
        tableIdOrName: z.string(),
        maxRecords: z.number().int().positive().max(100).optional(),
        view: z.string().optional(),
        filterByFormula: z.string().optional().describe('Airtable formula, e.g. "{Status}=\'Done\'"'),
      }),
      request: (i) => ({
        method: 'GET',
        path: `/${encodeURIComponent(i.baseId)}/${encodeURIComponent(i.tableIdOrName)}`,
        query: { maxRecords: i.maxRecords, view: i.view, filterByFormula: i.filterByFormula },
      }),
      output: (raw) => {
        const r = raw as { records?: RawRecord[]; offset?: string };
        return { records: (r.records ?? []).map(recordSummary), offset: r.offset };
      },
    }),

    httpAction({
      id: 'airtable.get_record',
      description: 'Get a single record by id.',
      input: z.object({ baseId: z.string(), tableIdOrName: z.string(), recordId: z.string() }),
      request: (i) => ({
        method: 'GET',
        path: `/${encodeURIComponent(i.baseId)}/${encodeURIComponent(i.tableIdOrName)}/${encodeURIComponent(i.recordId)}`,
      }),
      output: (raw) => recordSummary(raw as RawRecord),
    }),

    httpAction({
      id: 'airtable.create_record',
      description: 'Create a record with the given fields.',
      mutating: true,
      risk: 'medium',
      input: z.object({
        baseId: z.string(),
        tableIdOrName: z.string(),
        fields: z.record(z.unknown()),
        typecast: z.boolean().optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: `/${encodeURIComponent(i.baseId)}/${encodeURIComponent(i.tableIdOrName)}`,
        body: { fields: i.fields, ...(i.typecast !== undefined ? { typecast: i.typecast } : {}) },
      }),
      output: (raw) => recordSummary(raw as RawRecord),
    }),

    httpAction({
      id: 'airtable.update_record',
      description: 'Update fields on an existing record (partial update).',
      mutating: true,
      risk: 'medium',
      input: z.object({
        baseId: z.string(),
        tableIdOrName: z.string(),
        recordId: z.string(),
        fields: z.record(z.unknown()),
        typecast: z.boolean().optional(),
      }),
      request: (i) => ({
        method: 'PATCH',
        path: `/${encodeURIComponent(i.baseId)}/${encodeURIComponent(i.tableIdOrName)}/${encodeURIComponent(i.recordId)}`,
        body: { fields: i.fields, ...(i.typecast !== undefined ? { typecast: i.typecast } : {}) },
      }),
      output: (raw) => recordSummary(raw as RawRecord),
    }),

    httpAction({
      id: 'airtable.delete_record',
      description: 'Delete a record by id.',
      mutating: true,
      risk: 'high',
      input: z.object({ baseId: z.string(), tableIdOrName: z.string(), recordId: z.string() }),
      request: (i) => ({
        method: 'DELETE',
        path: `/${encodeURIComponent(i.baseId)}/${encodeURIComponent(i.tableIdOrName)}/${encodeURIComponent(i.recordId)}`,
      }),
      output: () => ({ deleted: true }),
    }),
  ],
});
