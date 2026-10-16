import { z } from 'zod/v4';
import { AppError } from '@ri/app-kit/contract';
import { defineAction } from '@ri/app-kit/sdk';
import { allows, writeResultSchema, type AccessScope } from '@ri/app-kit/data';
import { id, MATERIAL_KINDS, MATERIALS_SOURCE, materialFamilySchema, materialVersionSchema } from '../domain/model.js';
import { app } from '../server/state.js';
import { compareVersions, createMaterial, familyRecords, saveMaterialVersion, setMaterialArchived, versionRow, versionText } from '../server/materials.js';
import { listMaterials } from '../server/reads.js';
import { authorOf, COMMON_ERRORS, EX, exampleCoverage, exampleMaterial, listOutput, listShape, readScope, WRITE_ERRORS, writeScope } from './common.js';
import { str } from '../server/util.js';

function familyFor(familyId: string, scope: AccessScope) {
  if (!allows(scope, MATERIALS_SOURCE)) throw new AppError('forbidden', 'This caller was not given your materials');
  const row = app().db.prepare('SELECT * FROM material_families WHERE id = ?').get(familyId);
  if (!row) throw new AppError('not_found', 'This material is not available');
  return familyRecords([row], scope)[0];
}

export const listMaterialsAction = defineAction({
  name: 'list_materials',
  description: 'List résumés, cover letters and other materials with every version, whether each version is the original, edited, or submitted, and which opportunities used it.',
  input: z.object({ ...listShape, search: z.string().max(200).optional(), kind: z.enum(MATERIAL_KINDS).optional(), archived: z.boolean().default(false) }).strict(),
  output: listOutput(materialFamilySchema),
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: [...COMMON_ERRORS],
  examples: [{ input: { limit: 50, archived: false }, output: { items: [exampleMaterial], nextCursor: null, coverage: exampleCoverage, revision: 'r42' } }],
  handler: (input, invocation) => listMaterials(readScope(invocation), invocation.access, input),
});

export const getMaterialAction = defineAction({
  name: 'get_material',
  description: 'Read one material with its version history and the text of one version (the latest unless a version is named). Submitted versions are shown exactly as they were used.',
  input: z.object({ id, versionId: id.optional() }).strict(),
  output: z.object({ material: materialFamilySchema, version: materialVersionSchema, text: z.string(), textAvailable: z.boolean() }).strict(),
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: [...COMMON_ERRORS],
  examples: [{ input: { id: EX.material, versionId: EX.version3 }, output: { material: exampleMaterial, version: exampleMaterial.versions[1], text: 'Sam Rivera\nProduct designer\n...', textAvailable: true } }],
  handler: (input, invocation) => {
    const scope = readScope(invocation);
    const material = familyFor(input.id, scope);
    const version = material.versions.find((item) => item.id === (input.versionId ?? material.latestVersionId));
    if (!version) throw new AppError('not_found', 'This version is not available');
    const text = versionText(versionRow(version.id)!);
    return { material, version, text: text ?? '', textAvailable: text !== null };
  },
});

export const saveMaterialVersionAction = defineAction({
  name: 'save_material_version',
  description: 'Save a material. Without a familyId it creates a new material as version 1 (the original). With a familyId and the version you edited it saves the next version, linked to its parent, and never changes an earlier version or a recorded submission.',
  input: z.object({
    familyId: id.optional(),
    parentVersionId: id.optional(),
    expectedRevision: z.number().int().min(0).optional(),
    kind: z.enum(MATERIAL_KINDS).optional(),
    title: z.string().max(200).optional(),
    text: z.string().min(1).max(200_000),
    note: z.string().max(500).optional(),
  }).strict(),
  output: writeResultSchema(z.object({ material: materialFamilySchema, version: materialVersionSchema }).strict()),
  audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: [...WRITE_ERRORS],
  examples: [{ input: { familyId: EX.material, parentVersionId: EX.version3, expectedRevision: 3, text: 'Sam Rivera\nProduct designer\nShorter summary...' }, output: { status: 'saved', record: { material: exampleMaterial, version: exampleMaterial.versions[0] } } }],
  handler: (input, invocation) => {
    const scope = writeScope(invocation, MATERIALS_SOURCE, 'your materials');
    const author = authorOf(invocation);
    return app().store.mutate(invocation, 'save_material_version', input, () => {
      if (!input.familyId) {
        const created = createMaterial({ kind: input.kind ?? 'resume', title: input.title ?? 'Untitled material', text: input.text, note: input.note ?? null }, author);
        const material = familyFor(str(created.family.id), scope);
        return { status: 'saved' as const, record: { material, version: material.versions[0] } };
      }
      if (!input.parentVersionId || input.expectedRevision === undefined) throw new AppError('invalid_input', 'Name the version you edited and the revision you read');
      const result = saveMaterialVersion({ familyId: input.familyId, parentVersionId: input.parentVersionId, expectedRevision: input.expectedRevision, text: input.text, title: input.title ?? null, note: input.note ?? null }, author);
      const material = familyFor(input.familyId, scope);
      if (result.status === 'conflict') return { status: 'conflict' as const, current: { material, version: material.versions[0] }, message: 'A newer version was saved while you edited. Compare your text with it before saving' };
      return { status: 'saved' as const, record: { material, version: material.versions.find((version) => version.id === str(result.version.id))! } };
    });
  },
});

export const compareMaterialVersionsAction = defineAction({
  name: 'compare_material_versions',
  description: 'Compare the text of two versions of the same material line by line.',
  input: z.object({ fromVersionId: id, toVersionId: id }).strict(),
  output: z.object({
    from: z.object({ id, number: z.number().int() }).strict(),
    to: z.object({ id, number: z.number().int() }).strict(),
    lines: z.array(z.object({ type: z.enum(['same', 'added', 'removed']), text: z.string() }).strict()),
    truncated: z.boolean(), added: z.number().int(), removed: z.number().int(),
  }).strict(),
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: [...COMMON_ERRORS],
  examples: [{ input: { fromVersionId: EX.version3, toVersionId: EX.version4 }, output: { from: { id: EX.version3, number: 3 }, to: { id: EX.version4, number: 4 }, lines: [{ type: 'same', text: 'Sam Rivera' }, { type: 'removed', text: 'Long summary' }, { type: 'added', text: 'Shorter summary' }], truncated: false, added: 1, removed: 1 } }],
  handler: (input, invocation) => {
    const scope = readScope(invocation);
    if (!allows(scope, MATERIALS_SOURCE)) throw new AppError('forbidden', 'This caller was not given your materials');
    return compareVersions(input.fromVersionId, input.toVersionId);
  },
});

export const archiveMaterialAction = defineAction({
  name: 'archive_material',
  description: 'Archive or restore a material. Archived materials keep every version and remain linked to the submissions that used them.',
  input: z.object({ id, expectedRevision: z.number().int().min(0), archived: z.boolean() }).strict(),
  output: writeResultSchema(materialFamilySchema),
  audience: ['user'], effect: 'app_write', retry: 'idempotent', visibility: 'app', errors: [...WRITE_ERRORS],
  examples: [{ input: { id: EX.material, expectedRevision: 4, archived: true }, output: { status: 'saved', record: { ...exampleMaterial, archivedAt: '2026-10-15T09:00:00.000Z' } } }],
  handler: (input, invocation) => {
    const scope = writeScope(invocation, MATERIALS_SOURCE, 'your materials');
    return app().store.mutate(invocation, 'archive_material', input, () => {
      const row = setMaterialArchived(input.id, input.expectedRevision, input.archived);
      const material = familyFor(input.id, scope);
      return row ? { status: 'saved' as const, record: material } : { status: 'conflict' as const, current: material, message: 'This material changed since you opened it' };
    });
  },
});

export const materialActions = [listMaterialsAction, getMaterialAction, saveMaterialVersionAction, compareMaterialVersionsAction, archiveMaterialAction];
