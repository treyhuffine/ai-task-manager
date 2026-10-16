import { z } from 'zod/v4';
import type { AppDefinition } from '@ri/app-kit/sdk';
import { commonActions, registerViewActions } from './actions/common.js';
import { identityActions } from './actions/identity.js';
import { organizeActions } from './actions/organize.js';
import { peopleActions } from './actions/people.js';
import { relationshipActions } from './actions/relationship.js';
import { RESOURCE } from './actions/shared.js';
import { viewContextSchema } from './domain/context-packets.js';
import { opportunitySummarySchema, organizationSummarySchema, personSummarySchema } from './schemas.js';
export { initialize, shutdown } from './runtime.js';

/**
 * People: relationships, conversations and follow-ups. Importing this module
 * defines the actions only. It opens no database and performs no I/O, so the
 * build can generate the contract from it.
 */
const actions = [...commonActions, ...peopleActions, ...relationshipActions, ...organizeActions, ...identityActions];
registerViewActions(actions);

export const definition: AppDefinition = {
  packageId: 'ri-people',
  version: '0.1.0',
  actions,
  entities: [
    { type: 'person', idField: 'id', titleField: 'name', recordSchema: z.toJSONSchema(personSummarySchema) as Record<string, unknown>, readAction: 'get_person', listAction: 'list_people', searchAction: 'search_people', openPath: '/people/{id}' },
    { type: 'organization', idField: 'id', titleField: 'name', recordSchema: z.toJSONSchema(organizationSummarySchema) as Record<string, unknown>, readAction: 'get_organization', listAction: 'list_organizations', openPath: '/companies/{id}' },
    { type: 'opportunity', idField: 'id', titleField: 'title', recordSchema: z.toJSONSchema(opportunitySummarySchema) as Record<string, unknown>, readAction: 'get_opportunity', listAction: 'list_opportunities', openPath: '/opportunities/{id}' },
  ],
  contexts: { [RESOURCE]: viewContextSchema },
};
