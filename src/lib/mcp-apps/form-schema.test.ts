import { describe, expect, it } from 'vitest';
import { bitsAndBoltsForms as bitsAndBolts } from '@/test/fixtures/bits-and-bolts-forms';
import { acceptsFile, formContent, initialValues, parseForm, type ParsedForm } from './form-schema';

const parsed = (schema: unknown): ParsedForm => {
  const result = parseForm(schema);
  if (!result.ok) throw new Error(result.reason);
  return result.form;
};

/** A Bits & Bolts resource form whose field leaves `userOptions` out. */
function withoutUserOptions(schema: ReturnType<typeof bitsAndBolts.pickReferences>) {
  const copy = structuredClone(schema) as { properties: { references: { 'x-openai-input': Record<string, unknown> } } };
  delete copy.properties.references['x-openai-input'].userOptions;
  return copy;
}

describe('parseForm', () => {
  it('reads a titled select with descriptions, and shows images for every option once one has a thumbnail', () => {
    const [part] = parsed(bitsAndBolts.pickFile).fields;
    expect(part).toMatchObject({ kind: 'select', required: true, thumbnails: true, options: [
      { value: 'hex-bolt', title: 'M6 hex bolt', description: 'A fastener for the main joint.', thumbnail: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' } },
      { value: 'washer', title: 'M6 washer', description: 'Spreads the load.' },
    ] });
    expect(part!.kind === 'select' && part!.options[1]!.thumbnail).toBeUndefined();
  });

  it('reads single, explicit and implicit resource selection with thumbnails, both preview targets and user files', () => {
    const single = parsed(bitsAndBolts.pickReferences('single')).fields[0]!;
    expect(single).toMatchObject({ kind: 'resource', multiple: false, selection: 'explicit', userOptions: { kind: 'file', accept: ['.stl', '.3mf', '.step', '.stp'] } });
    if (single.kind !== 'resource') throw new Error('expected a resource field');
    expect(single.options[0]).toMatchObject({ uri: 'cad://parts/hex-bolt', thumbnail: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
      preview: { type: 'resource_link', uri: 'cad://parts/hex-bolt', name: 'hex-bolt.stl', mimeType: 'text/markdown' } });
    expect(single.options[1]!.preview).toEqual({ type: 'mcp_app_tool', name: 'cad.open', arguments: { file: { name: 'washer.stl', resourceUri: 'cad://parts/washer' } } });
    expect(parsed(bitsAndBolts.pickReferences('explicit')).fields[0]).toMatchObject({ multiple: true, selection: 'explicit' });
    expect(parsed(bitsAndBolts.pickReferences('implicit', 'directory')).fields[0]).toMatchObject({ multiple: true, selection: 'implicit', userOptions: { kind: 'directory', accept: [] } });
  });

  it('reads every field of the review form', () => {
    expect(parsed(bitsAndBolts.reviewForm).fields.map(f => [f.name, f.kind, f.required])).toEqual([
      ['reference', 'text', true], ['priority', 'select', true], ['purpose', 'text', false],
      ['checks', 'texts', false], ['approved', 'boolean', true], ['tolerance', 'number', true],
    ]);
    const [reference, , purpose, checks, , tolerance] = parsed(bitsAndBolts.reviewForm).fields;
    expect(reference).toMatchObject({ format: 'uri', default: 'cad://parts/hex-bolt' });
    // The server's pattern is accepted and never carried to the field, so neither Ri nor the browser runs it.
    expect(reference).not.toHaveProperty('pattern');
    expect(purpose).toMatchObject({ suggestions: [{ value: 'prototype', title: 'Prototype' }] });
    expect(checks).toMatchObject({ item: {}, suggestions: [{ value: 'clearance' }, { value: 'dimensions' }, { value: 'printability' }] });
    expect(tolerance).toMatchObject({ kind: 'number', integer: false });
    // Bounds decide nothing in Ri, so no field carries one to check or to hand the browser.
    for (const f of [purpose, checks, tolerance]) for (const bound of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'uniqueItems']) expect(f).not.toHaveProperty(bound);
  });

  it('takes a message-only form as a form with no fields', () => {
    expect(parsed(bitsAndBolts.reference).fields).toEqual([]);
  });

  it('refuses the whole form when any field is a shape OpenAI\'s SDK refuses, never part of it', () => {
    const refuse = (property: unknown) => parseForm({ type: 'object', properties: { ok: { type: 'string' }, odd: property } });
    for (const property of [
      { type: 'object', title: 'Nested', properties: {} },
      { type: 'string', format: 'color' },
      { type: 'array', items: { type: 'number' } },
      { type: 'string', enum: ['a'], 'x-openai-input': { type: 'resource', options: [] } },
      // A single resource cannot take a selection mode, and implicit selection cannot take a default.
      { type: 'string', format: 'uri', 'x-openai-input': { type: 'resource', selection: 'explicit', options: [] } },
      { type: 'array', items: { type: 'string', format: 'uri' }, default: ['x'], 'x-openai-input': { type: 'resource', selection: 'implicit', options: [{ uri: 'x', name: 'x' }] } },
      // Defaults must name a supplied resource.
      { type: 'string', format: 'uri', default: 'cad://other', 'x-openai-input': { type: 'resource', options: [{ uri: 'cad://parts/a', name: 'a' }] } },
      { type: 'number', minimum: '1' },
    ]) expect(refuse(property)).toMatchObject({ ok: false, reason: expect.stringMatching(/^"(odd|Nested)" uses an input type/) });
    expect(parseForm({ type: 'array' })).toMatchObject({ ok: false });
    expect(parseForm({ type: 'object', properties: { odd: { type: 'object', title: 'Address' } } })).toEqual({ ok: false, reason: '"Address" uses an input type Ri does not support.' });
  });

  it('accepts the deprecated file input type and thumbnail names, and ignores unknown keys as the SDK strips them', () => {
    const form = parsed({ type: 'object', properties: {
      a: { type: 'string', format: 'uri', 'x-openai-input': { type: 'file', options: [] } },
      b: { type: 'string', oneOf: [{ const: 'x', title: 'X', 'x-openai-preview': { src: 'https://example.com/x.png' } }], examples: ['x'] },
    } });
    expect(form.fields[0]).toMatchObject({ kind: 'resource' });
    expect(form.fields[1]).toMatchObject({ kind: 'select', thumbnails: true, options: [{ thumbnail: { src: 'https://example.com/x.png' } }] });
  });
});

describe('answers', () => {
  it('starts from defaults and keeps every option of an implicit selection', () => {
    expect(initialValues(parsed(bitsAndBolts.reviewForm))).toEqual({ reference: 'cad://parts/hex-bolt' });
    expect(initialValues(parsed(bitsAndBolts.pickReferences('implicit')))).toEqual({ references: ['cad://parts/hex-bolt', 'cad://parts/washer'] });
  });

  it('sends a review with suggested and custom checks as entered, leaving empty fields out', () => {
    const form = parsed(bitsAndBolts.reviewForm);
    expect(formContent(form, { reference: 'cad://parts/hex-bolt', priority: 'high', purpose: '', checks: ['clearance', 'custom-spacer'], approved: true, tolerance: 0.5 }))
      .toEqual({ reference: 'cad://parts/hex-bolt', priority: 'high', checks: ['clearance', 'custom-spacer'], approved: true, tolerance: 0.5 });
  });

  it('sends what the person entered whatever the schema says, for the server to judge', () => {
    const form = parsed(bitsAndBolts.reviewForm);
    // Out of bounds, outside its pattern and missing a required field: all the server's to refuse.
    expect(formContent(form, { reference: 'https://example.com/part', priority: 'urgent', tolerance: 12, checks: [''] }))
      .toEqual({ reference: 'https://example.com/part', priority: 'urgent', tolerance: 12, checks: [''] });
    // A required field left empty is left out, as an optional one is.
    expect(formContent(form, { reference: '', approved: true })).toEqual({ approved: true });
    // An implicit selection with every item removed still says so.
    expect(formContent(parsed(bitsAndBolts.pickReferences('implicit')), { references: [] })).toEqual({ references: [] });
  });

  it('lets an implicit selection without userOptions take any file, as OpenAI\'s spec defaults it', () => {
    expect(parsed(withoutUserOptions(bitsAndBolts.pickReferences('implicit'))).fields[0]).toMatchObject({ selection: 'implicit', userOptions: { kind: 'file', accept: [] } });
    // Explicit selection without userOptions shows no way to add one.
    expect(parsed(withoutUserOptions(bitsAndBolts.pickReferences('explicit'))).fields[0]).not.toHaveProperty('userOptions');
  });

  it('shows fields whatever their pattern, and never carries one, since nothing in Ri runs it', () => {
    const evil = '^(a+)+$';
    const form = parsed({ type: 'object', required: ['pattern'], properties: {
      code: { type: 'string', pattern: evil },
      password: { type: 'string', pattern: '^(?=.*\\d).{8,}$' },
      broken: { type: 'string', pattern: '(' },
      tags: { type: 'array', items: { type: 'string', pattern: evil } },
      parts: { type: 'array', items: { type: 'string', format: 'uri', pattern: '^cad:(a+)+$' }, 'x-openai-input': { type: 'resource', selection: 'explicit', options: [{ uri: 'cad:a', name: 'a' }], userOptions: { kind: 'file' } } },
      // A field may be named `pattern`, and `patternProperties` is ignored like any unknown key.
      pattern: { type: 'string', minLength: 2 },
    }, patternProperties: { [evil]: { type: 'number' } } });
    expect(form.fields.map(f => f.kind)).toEqual(['text', 'text', 'text', 'texts', 'resource', 'text']);
    for (const f of form.fields) expect(f).not.toHaveProperty('pattern');
  });

  it('matches files against accept the way an HTML file input does', () => {
    expect(acceptsFile(['.stl', '.STEP'], 'Bracket.step')).toBe(true);
    expect(acceptsFile(['.stl'], 'bracket.obj')).toBe(false);
    expect(acceptsFile(['image/*'], 'photo.heic', 'image/heic')).toBe(true);
    expect(acceptsFile(['application/pdf'], 'notes.pdf', 'application/pdf')).toBe(true);
    expect(acceptsFile([], 'anything')).toBe(true);
  });
});
