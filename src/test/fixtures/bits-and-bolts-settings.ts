/**
 * Bits & Bolts' structured settings, captured from its local MCP server
 * (`pnpm bits-and-bolts start`) on 2026-10-19: the `settings.read` result and
 * the tools its layout names. The conformance fixture for OpenAI's settings.
 */
export const bitsAndBoltsSettings = {
  schema: {
    type: 'object',
    properties: {
      units: { type: 'string', enum: ['mm', 'in'], title: 'Units' },
      showGrid: { type: 'boolean', title: 'Show grid' },
      defaultView: { type: 'string', enum: ['isometric', 'front', 'top'], title: 'Default view' },
    },
    required: ['units', 'showGrid', 'defaultView'],
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    additionalProperties: false,
  },
  layout: [
    { kind: 'group', title: 'Measurements', items: [{ kind: 'property', property: 'units' }] },
    { kind: 'group', title: '3D viewer', items: [{ kind: 'property', property: 'showGrid' }, { kind: 'property', property: 'defaultView' }] },
    { kind: 'group', title: 'Library', items: [{ kind: 'tool', tool: 'cad.library' }] },
  ],
  values: { units: 'mm', showGrid: true, defaultView: 'isometric' },
};
export const bitsAndBoltsTools = [
  { name: 'settings.read', annotations: { readOnlyHint: true } },
  { name: 'settings.update' },
  { name: 'cad.library', title: 'Parts Library', annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri: 'ui://bits-and-bolts/thread-v35' }, 'openai/ui': { entrypoints: [] } } },
  { name: 'cad.search', title: 'Search CAD parts', annotations: { readOnlyHint: true } },
];

