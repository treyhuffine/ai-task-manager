/**
 * OpenAI's structured settings (MCP extensions spec, "Structured Settings"),
 * as Ri reads and checks them. Pure, so the connection page validates the
 * same way the server does before an update leaves the Home.
 *
 * A server names a read tool and an update tool in
 * `capabilities.extensions["openai/settings"]`. The read tool returns a JSON
 * schema of primitive settings, a value for each, and an optional layout of
 * titled groups that mix settings with buttons for same-server tools.
 */
import type { McpCapabilityTool } from '@/lib/integrations/mcp-capabilities';
import { toolTitle, viewMetadata } from './metadata';

export type SettingValue = string | number | boolean;

interface FieldBase { key: string; title: string; description?: string }
export type SettingField =
  | FieldBase & { type: 'boolean' }
  | FieldBase & { type: 'string'; enum?: string[]; minLength?: number; maxLength?: number; pattern?: string }
  | FieldBase & { type: 'number' | 'integer'; minimum?: number; maximum?: number; multipleOf?: number }
  /** A property Ri can't offer a control for, shown with why rather than hidden or crashing the page. */
  | FieldBase & { type: 'unsupported'; reason: string };

export type SettingsItem =
  | { kind: 'property'; field: SettingField }
  /**
   * A button for a same-server tool, titled by the tool itself (OpenAI's
   * deprecated `title` on the item is ignored). `app` tools open their
   * interface. `available` is false when the server no longer lists the tool.
   */
  | { kind: 'tool'; tool: string; title: string; description?: string; app: boolean; available: boolean };

export interface SettingsGroup { title: string; items: SettingsItem[] }

export interface SettingsView {
  groups: SettingsGroup[];
  /** Current values, one per supported setting. */
  values: Record<string, SettingValue>;
}

export class SettingsReadError extends Error {}

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max = 500) => typeof value === 'string' && value.trim() && value.length <= max ? value : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** The groups a settings page shows when the server sets no layout, or for what its layout leaves out. */
export const OTHER_SETTINGS = 'Other settings';
export const ALL_SETTINGS = 'Settings';

/** One property of the read schema, as a field Ri can render, or the reason it can't. */
export function settingField(key: string, raw: unknown): SettingField {
  const property = record(raw);
  const title = text(property?.title, 200) ?? key;
  const description = text(property?.description, 2000);
  const base = { key, title, ...(description ? { description } : {}) };
  if (!property) return { ...base, type: 'unsupported', reason: 'This setting has no definition.' };
  for (const keyword of ['$ref', 'anyOf', 'oneOf', 'allOf'] as const)
    if (keyword in property) return { ...base, type: 'unsupported', reason: 'This setting uses a schema Ri does not show.' };
  const type = property.type;
  if (type === 'boolean') return { ...base, type: 'boolean' };
  if (type === 'string') {
    const options = Array.isArray(property.enum) ? property.enum : undefined;
    if (options && (!options.length || options.some(option => typeof option !== 'string'))) return { ...base, type: 'unsupported', reason: 'This setting lists choices that are not text.' };
    const pattern = typeof property.pattern === 'string' ? property.pattern : undefined;
    if (pattern !== undefined) {
      try { new RegExp(pattern, 'u'); } catch { return { ...base, type: 'unsupported', reason: 'This setting has a pattern Ri cannot check.' }; }
    }
    const minLength = count(property.minLength), maxLength = count(property.maxLength);
    return { ...base, type: 'string', ...(options ? { enum: [...new Set(options as string[])] } : {}),
      ...(minLength !== undefined ? { minLength } : {}), ...(maxLength !== undefined ? { maxLength } : {}), ...(pattern !== undefined ? { pattern } : {}) };
  }
  if (type === 'number' || type === 'integer') {
    if ('enum' in property) return { ...base, type: 'unsupported', reason: 'This setting lists numeric choices, which Ri does not show.' };
    const minimum = finite(property.minimum), maximum = finite(property.maximum), multipleOf = finite(property.multipleOf);
    return { ...base, type, ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}),
      ...(multipleOf !== undefined && multipleOf > 0 ? { multipleOf } : {}) };
  }
  return { ...base, type: 'unsupported', reason: 'Settings can be on or off, text, a choice, or a number. This one is another kind.' };
}

/** Why `value` is not a valid value for `field`, or null when it is. Messages are shown under the control. */
export function validateSetting(field: SettingField, value: unknown): string | null {
  switch (field.type) {
    case 'unsupported': return field.reason;
    case 'boolean': return typeof value === 'boolean' ? null : 'Choose on or off.';
    case 'string': {
      if (typeof value !== 'string') return 'Enter text.';
      if (field.enum) return field.enum.includes(value) ? null : 'Choose one of the listed options.';
      const length = [...value].length;
      if (field.minLength !== undefined && length < field.minLength) return field.minLength === 1 ? 'Enter a value.' : `Use at least ${field.minLength} characters.`;
      if (field.maxLength !== undefined && length > field.maxLength) return `Use at most ${field.maxLength} characters.`;
      if (field.pattern !== undefined && !new RegExp(field.pattern, 'u').test(value)) return 'This value is not in the expected format.';
      return null;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number.';
      if (field.type === 'integer' && !Number.isInteger(value)) return 'Enter a whole number.';
      if (field.minimum !== undefined && value < field.minimum) return `Use ${field.minimum} or more.`;
      if (field.maximum !== undefined && value > field.maximum) return `Use ${field.maximum} or less.`;
      if (field.multipleOf !== undefined) {
        const steps = value / field.multipleOf;
        if (Math.abs(steps - Math.round(steps)) > 1e-9 * Math.max(1, Math.abs(steps))) return `Use a multiple of ${field.multipleOf}.`;
      }
      return null;
    }
  }
}

/**
 * Read the `structuredContent` of the settings read tool. A malformed
 * envelope, or a layout that names an unknown setting or names one twice,
 * fails the whole read, as OpenAI's SDK refuses it. One property Ri can't
 * show, or a missing or invalid value, only marks that setting.
 */
export function parseSettingsRead(raw: unknown, tools: readonly McpCapabilityTool[]): SettingsView {
  const content = record(raw);
  const schema = record(content?.schema);
  if (!content || !schema || schema.type !== 'object') throw new SettingsReadError('The server returned settings in a shape Ri does not recognize.');
  const values = record(content.values);
  if (!values) throw new SettingsReadError('The server returned settings without their values.');
  const properties = record(schema.properties) ?? {};
  const fields = new Map<string, SettingField>();
  const kept: Record<string, SettingValue> = {};
  for (const [key, definition] of Object.entries(properties)) {
    let field = settingField(key, definition);
    if (field.type !== 'unsupported') {
      const value = values[key];
      const problem = !Object.hasOwn(values, key) ? 'The server sent no value for this setting.' : validateSetting(field, value);
      if (problem) field = { key, title: field.title, ...(field.description ? { description: field.description } : {}), type: 'unsupported', reason: Object.hasOwn(values, key) ? `The server's current value is invalid. ${problem}` : problem };
      else kept[key] = value as SettingValue;
    }
    fields.set(key, field);
  }
  const placed = new Set<string>();
  const groups: SettingsGroup[] = [];
  const layout = content.layout;
  if (layout !== undefined && !Array.isArray(layout)) throw new SettingsReadError('The server returned a settings layout Ri does not recognize.');
  for (const rawGroup of (layout as unknown[] | undefined) ?? []) {
    const group = record(rawGroup);
    const title = text(group?.title, 200);
    if (!group || group.kind !== 'group' || !title || !Array.isArray(group.items)) throw new SettingsReadError('The server returned a settings group Ri does not recognize.');
    const items: SettingsItem[] = [];
    for (const rawItem of group.items) {
      const item = record(rawItem);
      if (item?.kind === 'property' && typeof item.property === 'string') {
        if (!fields.has(item.property) || placed.has(item.property)) throw new SettingsReadError(`The server's settings layout names an unknown or repeated setting: ${item.property}.`);
        placed.add(item.property);
        items.push({ kind: 'property', field: fields.get(item.property)! });
      } else if (item?.kind === 'tool' && text(item.tool, 200)) {
        const name = item.tool as string;
        const tool = tools.find(candidate => candidate.name === name);
        const description = text(item.description, 2000);
        items.push({ kind: 'tool', tool: name, title: tool ? toolTitle(tool) : name, ...(description ? { description } : {}), app: !!tool && !!viewMetadata(tool), available: !!tool });
      } else throw new SettingsReadError('The server returned a settings item Ri does not recognize.');
    }
    groups.push({ title, items });
  }
  const rest = [...fields.values()].filter(field => !placed.has(field.key));
  if (rest.length) groups.push({ title: groups.length ? OTHER_SETTINGS : ALL_SETTINGS, items: rest.map(field => ({ kind: 'property' as const, field })) });
  return { groups, values: kept };
}

/** Every field in a view, by key. */
export function settingsFields(view: SettingsView): Map<string, SettingField> {
  return new Map(view.groups.flatMap(group => group.items.flatMap(item => item.kind === 'property' ? [[item.field.key, item.field] as const] : [])));
}

/** The tool buttons a view offers, by name. */
export function settingsTools(view: SettingsView): Map<string, Extract<SettingsItem, { kind: 'tool' }>> {
  return new Map(view.groups.flatMap(group => group.items.flatMap(item => item.kind === 'tool' ? [[item.tool, item] as const] : [])));
}

/**
 * The part of `set` that changes something, checked against the current
 * schema. OpenAI's spec has the host send only changed settings. Throws with
 * the first invalid or unknown key.
 */
export function changedSettings(view: SettingsView, set: Record<string, unknown>): Record<string, SettingValue> {
  const fields = settingsFields(view);
  const changed: Record<string, SettingValue> = {};
  for (const [key, value] of Object.entries(set)) {
    const field = fields.get(key);
    if (!field) throw new SettingsReadError(`This server has no setting named ${key}.`);
    const problem = validateSetting(field, value);
    if (problem) throw new SettingsReadError(`${field.title}: ${problem}`);
    if (view.values[key] !== value) changed[key] = value as SettingValue;
  }
  return changed;
}
