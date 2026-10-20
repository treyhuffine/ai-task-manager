import { describe, expect, it } from 'vitest';
import { ALL_SETTINGS, OTHER_SETTINGS, changedSettings, parseSettingsRead, settingField, validateSetting, type SettingField } from './settings-model';
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
    expect(view.groups.at(-1)).toEqual({ title: OTHER_SETTINGS, items: [{ kind: 'property', field: { key: 'gridSize', title: 'Grid size', type: 'number', minimum: 1 } }] });
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

  it('marks one setting Ri cannot show, or one without a valid value, instead of failing the page', () => {
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
    for (const key of ['colors', 'level', 'mode', 'nullable', 'missing', 'wrong', 'units']) expect(fields[key]).toMatchObject({ type: 'unsupported' });
    expect(fields.missing).toMatchObject({ reason: 'The server sent no value for this setting.' });
    expect(fields.wrong).toMatchObject({ reason: expect.stringContaining('current value is invalid') });
    expect(view.values).toEqual({});
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

describe('validating a value', () => {
  const field = (raw: Record<string, unknown>) => settingField('value', { title: 'Value', ...raw });
  it('checks text length in characters and enum choices', () => {
    const name = field({ type: 'string', minLength: 2, maxLength: 4 });
    expect(validateSetting(name, 'ab')).toBeNull();
    expect(validateSetting(name, 'a')).toBe('Use at least 2 characters.');
    expect(validateSetting(name, 'abcde')).toBe('Use at most 4 characters.');
    expect(validateSetting(field({ type: 'string', maxLength: 2 }), '🔩🔩')).toBeNull();
    expect(validateSetting(field({ type: 'string', minLength: 1 }), '')).toBe('Enter a value.');
    expect(validateSetting(field({ type: 'string', enum: ['mm', 'in'] }), 'cm')).toBe('Choose one of the listed options.');
  });

  it('never runs a server\'s pattern: the server checks it, whatever the pattern', () => {
    // A catastrophic pattern, one that is not a regular expression, and a value it would refuse: all left to the server.
    for (const pattern of ['^(a+)+$', '(', '^[a-z]+$']) {
      const shown = field({ type: 'string', pattern });
      expect(shown).toEqual({ key: 'value', title: 'Value', type: 'string' });
      const start = performance.now();
      expect(validateSetting(shown, `${'a'.repeat(40_000)}!`)).toBeNull();
      expect(validateSetting(shown, 'AB')).toBeNull();
      expect(performance.now() - start).toBeLessThan(50);
    }
  });

  it('checks numbers, whole numbers, bounds and steps, including decimal steps', () => {
    const tolerance = field({ type: 'number', minimum: 0, maximum: 10, multipleOf: 0.1 });
    expect(validateSetting(tolerance, 0.3)).toBeNull();
    expect(validateSetting(tolerance, 0.35)).toBe('Use a multiple of 0.1.');
    expect(validateSetting(tolerance, -1)).toBe('Use 0 or more.');
    expect(validateSetting(tolerance, 11)).toBe('Use 10 or less.');
    expect(validateSetting(tolerance, Number.NaN)).toBe('Enter a number.');
    expect(validateSetting(field({ type: 'integer' }), 1.5)).toBe('Enter a whole number.');
    expect(validateSetting(field({ type: 'integer', multipleOf: 0 }), 3)).toBeNull();
    expect(validateSetting(field({ type: 'boolean' }), 'true')).toBe('Choose on or off.');
  });
});

describe('changing settings', () => {
  const view = parseSettingsRead(bitsAndBoltsSettings, bitsAndBoltsTools);
  it('keeps only the settings that change, as OpenAI\'s spec has the host send', () => {
    expect(changedSettings(view, { units: 'in', showGrid: true })).toEqual({ units: 'in' });
    expect(changedSettings(view, { showGrid: true })).toEqual({});
  });

  it('refuses an unknown setting, an invalid value, or a setting Ri cannot show', () => {
    expect(() => changedSettings(view, { theme: 'dark' })).toThrow('no setting named theme');
    expect(() => changedSettings(view, { units: 'cm' })).toThrow('Units: Choose one of the listed options.');
    const unsupported = parseSettingsRead({ schema: { type: 'object', properties: { colors: { type: 'array', title: 'Colors' } } }, values: { colors: [] } }, []);
    expect(() => changedSettings(unsupported, { colors: 'red' })).toThrow('Colors:');
  });

  it('types every supported field', () => {
    const fields: SettingField[] = view.groups.flatMap(group => group.items.flatMap(item => item.kind === 'property' ? [item.field] : []));
    expect(fields.map(item => item.type)).toEqual(['string', 'boolean', 'string']);
  });
});
