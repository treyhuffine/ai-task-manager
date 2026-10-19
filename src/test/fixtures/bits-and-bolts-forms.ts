/**
 * Bits & Bolts' forms, as its server sends them (openai/mcp-extensions at the
 * pinned commit, plugins/bits-and-bolts/src/server/register.ts).
 */
export const bitsAndBoltsForms = {
  /** cad.pickFile: a titled select with descriptions and thumbnails. */
  pickFile: {
    type: 'object', required: ['part'],
    properties: { part: { type: 'string', title: 'CAD part', oneOf: [
      { const: 'hex-bolt', title: 'M6 hex bolt', description: 'A fastener for the main joint.', 'x-openai-thumbnail': { src: 'data:image/png;base64,iVBORw0KGgo=' } },
      { const: 'washer', title: 'M6 washer', description: 'Spreads the load.' },
    ] } },
  },
  /** cad.pickReferences: resource selection, single, explicit or implicit, with previews and user files. */
  pickReferences: (selection: 'single' | 'explicit' | 'implicit', kind: 'file' | 'directory' = 'file') => {
    const multiple = selection !== 'single';
    return {
      type: 'object', required: ['references'],
      properties: { references: {
        ...(multiple ? { type: 'array', items: { type: 'string', format: 'uri' } } : { type: 'string', format: 'uri' }),
        title: 'CAD references',
        'x-openai-input': {
          type: 'resource', ...(multiple ? { selection } : {}),
          options: [
            { uri: 'cad://parts/hex-bolt', name: 'hex-bolt.stl', title: 'M6 hex bolt', description: 'A fastener.', _meta: {
              'openai/thumbnail': { src: 'data:image/png;base64,iVBORw0KGgo=' },
              'openai/preview': { target: { type: 'resource_link', uri: 'cad://parts/hex-bolt', name: 'hex-bolt.stl', mimeType: 'text/markdown' } } } },
            { uri: 'cad://parts/washer', name: 'washer.stl', title: 'M6 washer', _meta: {
              'openai/preview': { target: { type: 'mcp_app_tool', name: 'cad.open', arguments: { file: { name: 'washer.stl', resourceUri: 'cad://parts/washer' } } } } } },
          ],
          userOptions: kind === 'file' ? { kind, accept: ['.stl', '.3mf', '.step', '.stp'] } : { kind },
        },
      } },
    };
  },
  /** cad.reviewForm: pattern, enum, suggestions on a string and on array items, boolean and number bounds. */
  reviewForm: {
    type: 'object', required: ['reference', 'priority', 'approved', 'tolerance'],
    properties: {
      reference: { type: 'string', title: 'Part reference', format: 'uri', pattern: '^(mcp|cad|file):', default: 'cad://parts/hex-bolt' },
      priority: { type: 'string', title: 'Priority', enum: ['low', 'normal', 'high'] },
      purpose: { type: 'string', title: 'Purpose', minLength: 1, 'x-openai-suggestions': [{ const: 'prototype', title: 'Prototype' }] },
      checks: { type: 'array', title: 'Checks', items: { type: 'string', minLength: 1, 'x-openai-suggestions': [
        { const: 'clearance', title: 'Clearance', description: 'Check spacing between assembled parts.' },
        { const: 'dimensions', title: 'Dimensions', description: 'Verify the overall size and tolerances.' },
        { const: 'printability', title: 'Printability', description: 'Review the shape for 3D printing.' },
      ] } },
      approved: { type: 'boolean', title: 'Ready for review' },
      tolerance: { type: 'number', title: 'Tolerance (mm)', minimum: 0, maximum: 10 },
    },
  },
  /** cad.reference: no fields, only the message. */
  reference: { type: 'object', properties: {} },
};
