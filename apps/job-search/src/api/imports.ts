import { z } from 'zod/v4';
import { AppError } from '@ri/app-kit/contract';
import { defineAction } from '@ri/app-kit/sdk';
import { compensationSchema, id, MATERIAL_KINDS, outcomeSchema, requirementSchema, stageSchema, workArrangementSchema } from '../domain/model.js';
import { app } from '../server/state.js';
import { applyImport, deleteImportedFile, listImportedFiles, previewImport, previewInputSchema } from '../server/imports.js';
import { authorOf, EX, writeScope } from './common.js';

const duplicateSchema = z.object({ id, company: z.string(), role: z.string(), stage: stageSchema }).strict();
const previewOutput = z.object({
  previewId: id,
  digest: z.string(),
  kind: z.enum(['posting', 'material', 'opportunities']),
  expiresAt: z.string(),
  posting: z.object({
    company: z.string().nullable(), role: z.string().nullable(), location: z.string().nullable(), workArrangement: workArrangementSchema.nullable(), sourceUrl: z.string().nullable(),
    requisitionId: z.string().nullable(), requirements: z.array(requirementSchema), requirementCount: z.number().int(), compensation: z.array(compensationSchema),
    characters: z.number().int(), hasText: z.boolean(), excerpt: z.string(), fileName: z.string().nullable(),
  }).strict().optional(),
  material: z.object({ title: z.string(), kind: z.enum(MATERIAL_KINDS), characters: z.number().int(), excerpt: z.string(), fileName: z.string().nullable() }).strict().optional(),
  rows: z.array(z.object({ index: z.number().int(), company: z.string(), role: z.string(), sourceUrl: z.string().nullable(), location: z.string().nullable(), stage: stageSchema, outcome: outcomeSchema.nullable(), appliedOn: z.string().nullable(), notes: z.string().nullable(), duplicate: z.boolean() }).strict()).optional(),
  rowCount: z.number().int().optional(),
  columns: z.array(z.string()).optional(),
  duplicates: z.array(duplicateSchema),
  warnings: z.array(z.string()),
}).strict();

export const previewImportAction = defineAction({
  name: 'preview_import',
  description: 'Read a job description (pasted text, a link with or without a pasted description, or a PDF, Word or text file), a résumé or cover letter, or a CSV of opportunities, and show what would be saved, with possible duplicates. Nothing is saved until apply_import. A link alone is kept as a link, never fetched.',
  input: previewInputSchema,
  output: previewOutput,
  audience: ['user'], effect: 'app_write', retry: 'idempotent', visibility: 'app', errors: ['invalid_input', 'forbidden', 'unsupported'],
  examples: [{
    input: { kind: 'posting', url: 'https://jobs.fieldwork.example/product-lead', text: 'Product lead at Fieldwork\nLocation: Remote, US\n\nRequirements\n- Five years leading product teams' },
    output: {
      previewId: EX.preview, digest: EX.digest, kind: 'posting', expiresAt: '2026-10-16T09:00:00.000Z',
      posting: { company: 'Fieldwork', role: 'Product lead', location: 'Remote, US', workArrangement: 'remote', sourceUrl: 'https://jobs.fieldwork.example/product-lead', requisitionId: null, requirements: [{ id: 'r1', text: 'Five years leading product teams', passage: '- Five years leading product teams', section: 'Requirements' }], requirementCount: 1, compensation: [], characters: 92, hasText: true, excerpt: 'Product lead at Fieldwork Location: Remote, US Requirements - Five years leading product teams', fileName: null },
      duplicates: [], warnings: [],
    },
  }],
  handler: async (input, invocation) => {
    writeScope(invocation, input.kind === 'material' ? 'materials' : 'manual', input.kind === 'material' ? 'your materials' : 'your saved jobs');
    if (invocation.principal.kind !== 'owner-ui' && invocation.principal.kind !== 'fixture') throw new AppError('forbidden', 'Only the person who owns this app can import files');
    return previewImport(invocation, input, authorOf(invocation));
  },
});

export const applyImportAction = defineAction({
  name: 'apply_import',
  description: 'Save exactly what a preview showed, once. The preview ID and digest must match. A retry, or a second import of the same source, returns the records already saved instead of duplicates.',
  input: z.object({
    previewId: id,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    decisions: z.object({
      company: z.string().max(200).optional(), role: z.string().max(200).optional(), location: z.string().max(200).nullable().optional(), workArrangement: workArrangementSchema.nullable().optional(),
      sourceUrl: z.string().max(2000).nullable().optional(), attachTo: id.nullable().optional(), title: z.string().max(200).optional(), materialKind: z.enum(MATERIAL_KINDS).optional(),
      skipRows: z.array(z.number().int().min(0)).max(500).optional(),
    }).strict().optional(),
  }).strict(),
  output: z.object({ status: z.literal('applied'), kind: z.enum(['posting', 'material', 'opportunities']), opportunityIds: z.array(id), materialId: id.nullable(), snapshotId: id.nullable(), created: z.number().int(), skipped: z.number().int() }).strict(),
  audience: ['user'], effect: 'app_write', retry: 'idempotent', visibility: 'app', errors: ['invalid_input', 'forbidden', 'not_found', 'conflict'],
  examples: [{ input: { previewId: EX.preview, digest: EX.digest, decisions: { company: 'Fieldwork', role: 'Product lead' } }, output: { status: 'applied', kind: 'posting', opportunityIds: [EX.opportunity], materialId: null, snapshotId: EX.snapshot, created: 1, skipped: 0 } }],
  handler: (input, invocation) => {
    if (invocation.principal.kind !== 'owner-ui' && invocation.principal.kind !== 'fixture') throw new AppError('forbidden', 'Only the person who owns this app can import files');
    writeScope(invocation);
    return app().store.mutate(invocation, 'apply_import', input, () => applyImport(input, authorOf(invocation)));
  },
});


export const listImportsAction = defineAction({
  name: 'list_imports',
  description: 'List files the person imported: job descriptions, materials and opportunity files, with how many records each created.',
  input: z.object({}).strict(),
  output: z.object({ items: z.array(z.object({ id, name: z.string(), kind: z.string(), importedAt: z.string(), records: z.number().int(), status: z.string() }).strict()) }).strict(),
  audience: ['user'], effect: 'read', retry: 'read_safe', visibility: 'app',
  examples: [{ input: {}, output: { items: [{ id: EX.preview, name: 'fieldwork-product-lead.pdf', kind: 'Job description', importedAt: '2026-10-14T08:30:00.000Z', records: 2, status: 'imported' }] } }],
  handler: (_input, invocation) => {
    if (invocation.principal.kind !== 'owner-ui' && invocation.principal.kind !== 'fixture') throw new AppError('forbidden', 'Only the person who owns this app can manage imports');
    return { items: listImportedFiles() };
  },
});

export const deleteImportAction = defineAction({
  name: 'delete_import',
  description: 'Delete what one imported file created, keeping anything the person has built on since: a description used by preparation, a submitted material, or an opportunity with its own history.',
  input: z.object({ id, confirm: z.literal('delete') }).strict(),
  output: z.object({ removed: z.number().int(), kept: z.number().int(), message: z.string() }).strict(),
  audience: ['user'], effect: 'app_write', retry: 'idempotent', visibility: 'app', errors: ['not_found', 'conflict', 'forbidden'],
  examples: [{ input: { id: EX.preview, confirm: 'delete' }, output: { removed: 2, kept: 0, message: '2 removed' } }],
  handler: (input, invocation) => {
    if (invocation.principal.kind !== 'owner-ui' && invocation.principal.kind !== 'fixture') throw new AppError('forbidden', 'Only the person who owns this app can manage imports');
    return app().store.mutate(invocation, 'delete_import', input, () => deleteImportedFile(input.id));
  },
});

export const importActions = [previewImportAction, applyImportAction, listImportsAction, deleteImportAction];
