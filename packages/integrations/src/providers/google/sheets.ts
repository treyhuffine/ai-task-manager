/**
 * The `google_sheets` toolkit. Sheets API is on `sheets.googleapis.com` (absolute URLs).
 * Shares the Google connection; reads need `spreadsheets.readonly`, writes need `spreadsheets`.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { GOOGLE_SCOPES } from './provider';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

export const googleSheets = defineToolkit({
  id: 'google_sheets',
  providerId: 'google',
  displayName: 'Google Sheets',
  actions: [
    httpAction({
      id: 'google_sheets.get_values',
      description: 'Read a range of cells from a spreadsheet (A1 notation, e.g. "Sheet1!A1:C10").',
      scopes: [GOOGLE_SCOPES.spreadsheetsReadonly],
      input: z.object({ spreadsheetId: z.string(), range: z.string() }),
      request: (i) => ({
        method: 'GET',
        path: `${SHEETS}/${encodeURIComponent(i.spreadsheetId)}/values/${encodeURIComponent(i.range)}`,
      }),
      output: (raw) => {
        const r = raw as { range?: string; values?: unknown[][] };
        return { range: r.range, values: r.values ?? [] };
      },
    }),

    httpAction({
      id: 'google_sheets.append_values',
      description: 'Append rows to a sheet range (values is an array of rows).',
      mutating: true,
      risk: 'medium',
      scopes: [GOOGLE_SCOPES.spreadsheets],
      input: z.object({
        spreadsheetId: z.string(),
        range: z.string().describe('A1 range to append into, e.g. "Sheet1!A1"'),
        values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))),
      }),
      request: (i) => ({
        method: 'POST',
        path: `${SHEETS}/${encodeURIComponent(i.spreadsheetId)}/values/${encodeURIComponent(i.range)}:append`,
        query: { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' },
        body: { values: i.values },
      }),
      output: (raw) => {
        const r = raw as { updates?: { updatedRange?: string; updatedRows?: number } };
        return { updatedRange: r.updates?.updatedRange, updatedRows: r.updates?.updatedRows };
      },
    }),

    httpAction({
      id: 'google_sheets.update_values',
      description: 'Overwrite a range of cells with the given values.',
      mutating: true,
      risk: 'medium',
      scopes: [GOOGLE_SCOPES.spreadsheets],
      input: z.object({
        spreadsheetId: z.string(),
        range: z.string(),
        values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))),
      }),
      request: (i) => ({
        method: 'PUT',
        path: `${SHEETS}/${encodeURIComponent(i.spreadsheetId)}/values/${encodeURIComponent(i.range)}`,
        query: { valueInputOption: 'USER_ENTERED' },
        body: { values: i.values },
      }),
      output: (raw) => {
        const r = raw as { updatedRange?: string; updatedCells?: number };
        return { updatedRange: r.updatedRange, updatedCells: r.updatedCells };
      },
    }),

    httpAction({
      id: 'google_sheets.create_spreadsheet',
      description: 'Create a new spreadsheet with a title.',
      mutating: true,
      risk: 'medium',
      scopes: [GOOGLE_SCOPES.spreadsheets],
      input: z.object({ title: z.string() }),
      request: (i) => ({ method: 'POST', path: SHEETS, body: { properties: { title: i.title } } }),
      output: (raw) => {
        const r = raw as { spreadsheetId?: string; spreadsheetUrl?: string };
        return { spreadsheetId: r.spreadsheetId, spreadsheetUrl: r.spreadsheetUrl };
      },
    }),
  ],
});
