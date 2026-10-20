import { describe, expect, it } from 'vitest';
import { ALL_SETTINGS, OTHER_SETTINGS, parseSettingsRead, settingField, type SettingField } from './settings-model';
import { bitsAndBoltsSettings, bitsAndBoltsTools } from '@/test/fixtures/bits-and-bolts-settings';


describe('reading settings', () => {
  it('lays out Bits & Bolts settings in its groups, with its library button titled by the tool', () => {
    const view = parseSettingsRead(bitsAndBoltsSettings, bitsAndBoltsTools);
    expect(view.values).toEqual({ units: 'mm', showGrid: true, defaultView: 'isometric' });
    expect(view.groups.map(group => [group.title, group.items.map(item => item.kind === 'property' ? item.field.key : `tool:${item.tool}`)])).toEqual([
      ['Measurements', ['units']], ['3D viewer', ['showGrid', 'defaultView']], ['Library', ['tool:cad.library']],
    ]);
    expect(view.groups[0].items[0]).toEqual({ kind: 'property', field: { key: 'units', title: 'Units', type: 'string', enum: ['mm', 'in'] } });
    expect(view.groups[2].items[0]).toEqual({ kind: 'tool', tool: 'cad.library', title: 'Parts Library', app: true, available: true });
  });

  it('puts what the layout leaves out in Other settings after the listed groups, and everything in Settings without a layout', () => {
    const extra = { ...bitsAndBoltsSettings, schema: { ...bitsAndBoltsSettings.schema, properties: { ...bitsAndBoltsSettings.schema.properties, gridSize: { type: 'number', title: 'Grid size', minimum: 1 } } }, values: { ...bitsAndBoltsSettings.values, gridSize: 10 } };
    const view = parseSettingsRead(extra, bitsAndBoltsTools);
    expect(view.groups.at(-1)).toEqual({ title: OTHER_SETTINGS, items: [{ kind: 'property', field: { key: 'gridSize', title: 'Grid size', type: 'number' } }] });
    const plain = parseSettingsRead({ schema: bitsAndBoltsSettings.schema, values: bitsAndBoltsSettings.values }, []);
    expect(plain.groups.map(group => group.title)).toEqual([ALL_SETTINGS]);
    expect(plain.groups[0].items).toHaveLength(3);
  });

  it('ignores a button\'s deprecated title, takes annotations.title, and marks a tool the server no longer lists', () => {
    const layout = [{ kind: 'group', title: 'Actions', items: [
      { kind: 'tool', tool: 'cad.search', title: 'Old title', description: 'Find parts' },
      { kind: 'tool', tool: 'export', title: 'Export' },
      { kind: 'tool', tool: 'gone' },
    ] }];
    const view = parseSettingsRead({ ...bitsAndBoltsSettings, layout }, [...bitsAndBoltsTools, { name: 'export', annotations: { title: 'Export library' } }]);
    expect(view.groups[0].items).toEqual([
      { kind: 'tool', tool: 'cad.search', title: 'Search CAD parts', description: 'Find parts', app: false, available: true },
      { kind: 'tool', tool: 'export', title: 'Export library', app: false, available: true },
      { kind: 'tool', tool: 'gone', title: 'gone', app: false, available: false },
    ]);
  });

  it('marks one setting Ri cannot show instead of failing the page, and shows the server\'s values unjudged', () => {
    const read = { schema: { type: 'object', properties: {
      colors: { type: 'array', title: 'Colors', items: { type: 'string' } },
      level: { type: 'integer', title: 'Level', enum: [1, 2] },
      mode: { anyOf: [{ type: 'string' }], title: 'Mode' },
      nullable: { type: ['string', 'null'], title: 'Nullable' },
      missing: { type: 'boolean', title: 'Missing' },
      wrong: { type: 'boolean', title: 'Wrong' },
      units: { type: 'string', enum: ['mm', 'in'], title: 'Units' },
    } }, values: { colors: [], level: 1, mode: 'a', nullable: null, wrong: 'yes', units: 'cm' } };
    const view = parseSettingsRead(read, []);
    const fields = Object.fromEntries(view.groups[0].items.map(item => [item.kind === 'property' ? item.field.key : '', item.kind === 'property' ? item.field : null]));
    for (const key of ['colors', 'level', 'mode', 'nullable']) expect(fields[key]).toMatchObject({ type: 'unsupported' });
    // Kinds Ri draws keep their control whatever the server's value: the server judges values, not Ri.
    expect(fields.missing).toEqual({ key: 'missing', title: 'Missing', type: 'boolean' });
    expect(fields.wrong).toEqual({ key: 'wrong', title: 'Wrong', type: 'boolean' });
    expect(fields.units).toEqual({ key: 'units', title: 'Units', type: 'string', enum: ['mm', 'in'] });
    expect(view.values).toEqual({ wrong: 'yes', units: 'cm' });
  });

  it('refuses a malformed read, or a layout naming an unknown or repeated setting, as OpenAI\'s SDK does', () => {
    expect(() => parseSettingsRead({ values: {} }, [])).toThrow('shape');
    expect(() => parseSettingsRead({ schema: { type: 'object' } }, [])).toThrow('without their values');
    expect(() => parseSettingsRead({ ...bitsAndBoltsSettings, layout: [{ kind: 'group', title: 'X', items: [{ kind: 'property', property: 'nope' }] }] }, [])).toThrow('unknown or repeated setting: nope');
    expect(() => parseSettingsRead({ ...bitsAndBoltsSettings, layout: [
      { kind: 'group', title: 'A', items: [{ kind: 'property', property: 'units' }] },
      { kind: 'group', title: 'B', items: [{ kind: 'property', property: 'units' }] },
    ] }, [])).toThrow('repeated');
    expect(() => parseSettingsRead({ ...bitsAndBoltsSettings, layout: [{ kind: 'section', title: 'A', items: [] }] }, [])).toThrow('group');
    expect(() => parseSettingsRead({ ...bitsAndBoltsSettings, layout: [{ kind: 'group', title: 'A', items: [{ kind: 'link', href: 'x' }] }] }, [])).toThrow('item');
  });
});

describe('what a setting checks', () => {
  const field = (raw: Record<string, unknown>) => settingField('value', { title: 'Value', ...raw });
  it('keeps only its kind: bounds, steps and a pattern are the server\'s to judge', () => {
    expect(field({ type: 'string', minLength: 2, maxLength: 4, pattern: '^(a+)+$' })).toEqual({ key: 'value', title: 'Value', type: 'string' });
    expect(field({ type: 'string', enum: ['mm', 'in', 'mm'] })).toEqual({ key: 'value', title: 'Value', type: 'string', enum: ['mm', 'in'] });
    expect(field({ type: 'number', minimum: 0, maximum: 10, multipleOf: 0.1 })).toEqual({ key: 'value', title: 'Value', type: 'number' });
    expect(field({ type: 'integer', minimum: 1 })).toEqual({ key: 'value', title: 'Value', type: 'integer' });
  });

  const view = parseSettingsRead(bitsAndBoltsSettings, bitsAndBoltsTools);
  it('types every supported field', () => {
    const fields: SettingField[] = view.groups.flatMap(group => group.items.flatMap(item => item.kind === 'property' ? [item.field] : []));
    expect(fields.map(item => item.type)).toEqual(['string', 'boolean', 'string']);
  });
});
