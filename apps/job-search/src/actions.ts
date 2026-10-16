/**
 * Job Search action definitions. Importing this module opens nothing: the
 * build imports `definition` to generate contract.json. Storage opens in
 * `initialize`, from the host-resolved data directory.
 */
import { z } from 'zod/v4';
import type { AppDefinition, Bootstrap } from '@ri/app-kit/sdk';
import { interviewSchema, materialFamilySchema, opportunityRecordSchema } from './domain/model.js';
import { closeState, openState } from './server/state.js';
import { contextStateSchema, RESOURCE } from './server/view.js';
import { opportunityActions } from './api/opportunities.js';
import { interviewActions } from './api/interviews.js';
import { materialActions } from './api/materials.js';
import { preparationActions } from './api/preparation.js';
import { reviewActions } from './api/review.js';
import { sourceActions } from './api/sources.js';
import { importActions } from './api/imports.js';
import { followUpActions } from './api/followups.js';
import { viewActions } from './api/view.js';

const schema = (value: z.ZodType) => z.toJSONSchema(value) as Record<string, unknown>;

export const definition: AppDefinition = {
  packageId: 'ri-job-search',
  version: '0.1.0',
  actions: [...viewActions, ...opportunityActions, ...interviewActions, ...materialActions, ...preparationActions, ...reviewActions, ...followUpActions, ...importActions, ...sourceActions],
  entities: [
    { type: 'opportunity', idField: 'id', titleField: 'company', recordSchema: schema(opportunityRecordSchema), readAction: 'get_opportunity', listAction: 'list_opportunities', searchAction: 'list_opportunities', openPath: '/opportunities/{id}' },
    { type: 'interview', idField: 'id', titleField: 'title', recordSchema: schema(interviewSchema), listAction: 'list_interviews', openPath: '/interviews/{id}' },
    { type: 'material', idField: 'id', titleField: 'title', recordSchema: schema(materialFamilySchema), readAction: 'get_material', listAction: 'list_materials', searchAction: 'list_materials', openPath: '/materials/{id}' },
  ],
  contexts: { [RESOURCE]: contextStateSchema },
};

export async function initialize(boot: Pick<Bootstrap, 'dataDir' | 'instanceId'>) {
  await openState(boot);
}

export function shutdown() {
  closeState();
}
