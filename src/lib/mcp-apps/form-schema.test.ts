import { describe, expect, it } from 'vitest';
import { bitsAndBoltsForms as bitsAndBolts } from '@/test/fixtures/bits-and-bolts-forms';
import { acceptsFile, formContent, formErrors, initialValues, parseForm, type ParsedForm } from './form-schema';

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
    expect(purpose).toMatchObject({ minLength: 1, suggestions: [{ value: 'prototype', title: 'Prototype' }] });
    expect(checks).toMatchObject({ item: { minLength: 1 }, suggestions: [{ value: 'clearance' }, { value: 'dimensions' }, { value: 'printability' }] });
    expect(tolerance).toMatchObject({ kind: 'number', integer: false, minimum: 0, maximum: 10 });
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

  it('accepts a valid review, with suggested and custom checks, as the server will', () => {
    const form = parsed(bitsAndBolts.reviewForm);
    const content = formContent(form, { reference: 'cad://parts/hex-bolt', priority: 'high', purpose: '', checks: ['clearance', 'custom-spacer'], approved: true, tolerance: 0.5 });
    expect(content).toEqual({ reference: 'cad://parts/hex-bolt', priority: 'high', checks: ['clearance', 'custom-spacer'], approved: true, tolerance: 0.5 });
    expect(formErrors(form, content)).toEqual({});
  });

  it('names each broken constraint on its field, and leaves the server\'s pattern to the server', () => {
    const form = parsed(bitsAndBolts.reviewForm);
    // `reference` declares `^(mcp|cad|file):`, which the server checks when the answer reaches it.
    expect(formErrors(form, { reference: 'https://example.com/part', priority: 'urgent', tolerance: 12, checks: [''] })).toEqual({
      priority: 'Choose one of the options.',
      tolerance: 'Use 10 or less.',
      checks: 'This is too short.',
      approved: 'This is required.',
    });
    expect(formErrors(form, { reference: 'cad://x', priority: 'low', approved: 'yes', tolerance: 1 })).toMatchObject({ approved: expect.any(String) });
    expect(formErrors(form, { reference: 'cad://x', priority: 'low', approved: true, tolerance: 1, other: 'x' })).toEqual({ '': 'The answer names a field the form does not have.' });
  });

  it('holds a resource answer to the listed items unless the person may add their own', () => {
    const closed = parsed({ type: 'object', properties: { part: { type: 'string', format: 'uri', 'x-openai-input': { type: 'resource', options: [{ uri: 'cad://parts/a', name: 'a' }] } } } });
    expect(formErrors(closed, { part: 'cad://parts/a' })).toEqual({});
    expect(formErrors(closed, { part: 'file:///etc/passwd' })).toEqual({ part: 'Choose from the listed items.' });
    expect(formErrors(parsed(bitsAndBolts.pickReferences('single')), { references: 'file:///Users/me/parts/bracket.step' })).toEqual({});
    // An implicit selection whose adding was taken away (a remote server's) holds to its items too.
    const implicit = parsed(withoutUserOptions(bitsAndBolts.pickReferences('implicit')));
    const field = implicit.fields[0] as Extract<typeof implicit.fields[0], { kind: 'resource' }>;
    const closedImplicit = { ...implicit, fields: [{ ...field, userOptions: undefined }] };
    expect(formErrors(closedImplicit, { references: ['cad://parts/washer'] })).toEqual({});
    expect(formErrors(closedImplicit, { references: ['file:///Users/me/bracket.step'] })).toEqual({ references: 'Choose from the listed items.' });
  });

  it('lets an implicit selection without userOptions take any file, as OpenAI\'s spec defaults it', () => {
    expect(parsed(withoutUserOptions(bitsAndBolts.pickReferences('implicit'))).fields[0]).toMatchObject({ selection: 'implicit', userOptions: { kind: 'file', accept: [] } });
    expect(formErrors(parsed(withoutUserOptions(bitsAndBolts.pickReferences('implicit'))), { references: ['cad://parts/washer', 'file:///Users/me/bracket.obj'] })).toEqual({});
    // Explicit selection without userOptions shows no way to add one.
    expect(parsed(withoutUserOptions(bitsAndBolts.pickReferences('explicit'))).fields[0]).not.toHaveProperty('userOptions');
  });

  it('never runs a server\'s pattern, in any field, and leaves it to the server', () => {
    // Catastrophic, lookahead and invalid patterns alike: the form shows, and no answer is refused for a pattern.
    const evil = '^(a+)+$', long = `${'a'.repeat(40_000)}!`;
    const form = parsed({ type: 'object', properties: {
      code: { type: 'string', pattern: evil },
      password: { type: 'string', pattern: '^(?=.*\\d).{8,}$' },
      broken: { type: 'string', pattern: '(' },
      tags: { type: 'array', items: { type: 'string', pattern: evil } },
      parts: { type: 'array', items: { type: 'string', format: 'uri', pattern: '^cad:(a+)+$' }, 'x-openai-input': { type: 'resource', selection: 'explicit', options: [{ uri: 'cad:a', name: 'a' }], userOptions: { kind: 'file' } } },
    } });
    expect(form.fields.map(f => f.kind)).toEqual(['text', 'text', 'text', 'texts', 'resource']);
    for (const f of form.fields) expect(f).not.toHaveProperty('pattern');
    const start = performance.now();
    expect(formErrors(form, { code: long, password: 'no digits here', broken: 'x', tags: ['aaa', long], parts: [`cad:${long}`] })).toEqual({});
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('keeps a field named pattern, and never runs patternProperties', () => {
    const form = parsed({ type: 'object', required: ['pattern'], properties: { pattern: { type: 'string', minLength: 2 } }, patternProperties: { '^(a+)+$': { type: 'number' } } });
    expect(formErrors(form, { pattern: 'x' })).toEqual({ pattern: 'Use at least 2 characters.' });
    expect(formErrors(form, { pattern: 'xy' })).toEqual({});
    // A forged answer key against a catastrophic patternProperties: the validator would have backtracked for minutes.
    const start = performance.now();
    expect(formErrors(form, { pattern: 'xy', [`${'a'.repeat(30)}!`]: 1 } as Record<string, unknown>)).toEqual({ '': 'The answer names a field the form does not have.' });
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('matches files against accept the way an HTML file input does', () => {
    expect(acceptsFile(['.stl', '.STEP'], 'Bracket.step')).toBe(true);
    expect(acceptsFile(['.stl'], 'bracket.obj')).toBe(false);
    expect(acceptsFile(['image/*'], 'photo.heic', 'image/heic')).toBe(true);
    expect(acceptsFile(['application/pdf'], 'notes.pdf', 'application/pdf')).toBe(true);
    expect(acceptsFile([], 'anything')).toBe(true);
  });
});
