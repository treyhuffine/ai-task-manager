import { Validator, type Schema } from '@cfworker/json-schema';
import { safeMcpIcon, type McpIcon } from '@/lib/integrations/mcp-icons';
import { matchesPattern, validPattern } from './safe-pattern';

/**
 * The forms an MCP server can ask a person to fill: MCP's form elicitation
 * and OpenAI's extended forms (openai/mcp-extensions docs/spec.md, "OpenAI
 * Form Elicitation"). Shared by the Home, which checks a form before showing
 * it and an answer before returning it, and the browser, which renders it.
 *
 * `parseForm` accepts exactly the field shapes OpenAI's SDK accepts
 * (typescript/src/shared/forms), tried in the same order, and refuses the
 * whole form when one field matches none: OpenAI's spec reports such a form
 * as unsupported rather than showing part of it. Unknown keys are ignored, as
 * the SDK's schemas strip them. `formErrors` validates an answer the way the
 * SDK's `createOpenAIFormContentSchema` does, with the same validator, except
 * that a server's `pattern` runs in linear time (`safe-pattern.ts`) and never
 * in the validator's backtracking engine.
 */

export type FormValue = string | number | boolean | string[];
export type FormContent = Record<string, FormValue>;
export type StringFormat = 'email' | 'uri' | 'date' | 'date-time';

/** A titled choice: a select option, a multi-select option or a suggestion. */
export interface FormOption { value: string; title: string; description?: string; thumbnail?: McpIcon }

/** Opens expanded details for a resource option (`_meta["openai/preview"]`). */
export type PreviewTarget =
  | { type: 'mcp_app_tool'; name: string; arguments: Record<string, unknown> }
  | { type: 'resource_link'; uri: string; name: string; title?: string; mimeType?: string };

/** A server-supplied resource a person may pick (`x-openai-input.options`). */
export interface ResourceOption {
  uri: string; name: string; title?: string; description?: string; mimeType?: string;
  thumbnail?: McpIcon; preview?: PreviewTarget;
}

export interface UserResourceOptions { kind: 'file' | 'directory'; accept: string[] }

interface FieldBase { name: string; title?: string; description?: string; required: boolean }
export type FormField = FieldBase & (
  | { kind: 'text'; format?: StringFormat; minLength?: number; maxLength?: number; pattern?: string; default?: string; suggestions: FormOption[] }
  | { kind: 'number'; integer: boolean; minimum?: number; maximum?: number; default?: number }
  | { kind: 'boolean'; default?: boolean }
  /** One of a fixed list: titled `oneOf`, or `enum` with optional `enumNames`. */
  | { kind: 'select'; options: FormOption[]; default?: string; thumbnails: boolean }
  /** Several of a fixed list: titled `items.anyOf`, or `items.enum`. */
  | { kind: 'multiselect'; options: FormOption[]; minItems?: number; maxItems?: number; default?: string[]; thumbnails: boolean }
  /** Free-form strings, with optional suggestions. */
  | { kind: 'texts'; item: { format?: StringFormat; minLength?: number; maxLength?: number; pattern?: string }; suggestions: FormOption[]; minItems?: number; maxItems?: number; uniqueItems: boolean; default?: string[] }
  /** OpenAI's resource selection (`x-openai-input`), one URI or several. */
  | { kind: 'resource'; multiple: boolean; selection: 'explicit' | 'implicit'; options: ResourceOption[]; userOptions?: UserResourceOptions; minItems?: number; maxItems?: number; default?: string | string[]; pattern?: string }
);
export type FieldKind = FormField['kind'];

export interface ParsedForm {
  fields: FormField[];
  /** The requested schema as sent, which `formErrors` validates answers against. */
  schema: Record<string, unknown>;
  /** Whether any field takes a resource, so the answer gets the file-selection check. */
  hasResources: boolean;
}
export type FormParse = { ok: true; form: ParsedForm } | { ok: false; reason: string };

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const FORMATS = new Set<string>(['email', 'uri', 'date', 'date-time']);

/** A schema keyword check: absent, or the right type. `null` means the field does not match this shape. */
type Check = (value: unknown) => boolean;
const optional = (check: Check): Check => value => value === undefined || check(value);
const isString: Check = value => typeof value === 'string';
const isNumber: Check = value => typeof value === 'number' && Number.isFinite(value);
const isBoolean: Check = value => typeof value === 'boolean';
const isStrings: Check = value => Array.isArray(value) && value.every(isString);
const absent: Check = value => value === undefined;

function matches(field: Record<string, unknown>, shape: Record<string, Check>) {
  return Object.entries(shape).every(([key, check]) => check(field[key]));
}

/** MCP's `Icon`: a string `src`, with optional type, sizes and theme. Only safe ones are kept for display. */
const isIcon: Check = value => {
  const icon = record(value);
  return !!icon && isString(icon.src) && optional(isString)(icon.mimeType) && optional(isStrings)(icon.sizes) && optional(v => v === 'light' || v === 'dark')(icon.theme);
};

/** A titled option (`const` and `title`), with OpenAI's optional `description` and thumbnail. */
const isOption: Check = value => {
  const option = record(value);
  return !!option && isString(option.const) && isString(option.title) && optional(isString)(option.description)
    && optional(isIcon)(option['x-openai-thumbnail']) && optional(isIcon)(option['x-openai-preview']);
};
const isOptions: Check = value => Array.isArray(value) && value.every(isOption);
function option(value: unknown): FormOption {
  const raw = record(value)!;
  // `x-openai-preview` is the deprecated name for an option's thumbnail.
  const thumbnail = safeMcpIcon(raw['x-openai-thumbnail'] ?? raw['x-openai-preview']) ?? undefined;
  return { value: raw.const as string, title: raw.title as string, ...(typeof raw.description === 'string' ? { description: raw.description } : {}), ...(thumbnail ? { thumbnail } : {}) };
}

const base = { title: optional(isString), description: optional(isString) };
const arrayBase = { type: (v: unknown) => v === 'array', ...base, minItems: optional(isNumber), maxItems: optional(isNumber), default: optional(isStrings) };
/** OpenAI's extended StringSchema: MCP's, plus `pattern` and suggestions. */
const stringShape = {
  type: (v: unknown) => v === 'string', ...base, minLength: optional(isNumber), maxLength: optional(isNumber),
  format: optional(v => typeof v === 'string' && FORMATS.has(v)), default: optional(isString), pattern: optional(isString),
  'x-openai-suggestions': optional(isOptions),
};
const noChoices = { enum: absent, oneOf: absent, anyOf: absent };

/** `ResourceSchema`: name and uri, with optional title, description, mimeType, size and `_meta`. */
const isResource: Check = value => {
  const resource = record(value);
  return !!resource && isString(resource.uri) && isString(resource.name) && optional(isString)(resource.title)
    && optional(isString)(resource.description) && optional(isString)(resource.mimeType) && optional(isNumber)(resource.size)
    && optional(v => !!record(v))(resource._meta) && optional(v => Array.isArray(v) && v.every(isIcon))(resource.icons);
};
const isFileInput = (allowSelection: boolean): Check => value => {
  const input = record(value);
  if (!input || (input.type !== 'resource' && input.type !== 'file') || !Array.isArray(input.options) || !input.options.every(isResource)) return false;
  const user = input.userOptions === undefined ? {} : record(input.userOptions);
  if (!user || !optional(v => v === 'file' || v === 'directory')(user.kind) || !optional(isStrings)(user.accept)) return false;
  return allowSelection ? optional(v => v === 'explicit' || v === 'implicit')(input.selection) : input.selection === undefined;
};

function previewTarget(value: unknown): PreviewTarget | undefined {
  const target = record(record(value)?.target);
  if (!target) return undefined;
  if (target.type === 'mcp_app_tool' && typeof target.name === 'string' && target.name.trim() && (target.arguments === undefined || record(target.arguments)))
    return { type: 'mcp_app_tool', name: target.name, arguments: { ...(record(target.arguments) ?? {}) } };
  if (target.type === 'resource_link' && typeof target.uri === 'string' && typeof target.name === 'string')
    return { type: 'resource_link', uri: target.uri, name: target.name, ...(typeof target.title === 'string' ? { title: target.title } : {}), ...(typeof target.mimeType === 'string' ? { mimeType: target.mimeType } : {}) };
  return undefined;
}
function resourceOption(value: unknown): ResourceOption {
  const raw = record(value)!, meta = record(raw._meta) ?? {};
  const thumbnail = safeMcpIcon(meta['openai/thumbnail']) ?? undefined;
  const preview = previewTarget(meta['openai/preview']);
  return { uri: raw.uri as string, name: raw.name as string,
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}), ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(typeof raw.mimeType === 'string' ? { mimeType: raw.mimeType } : {}), ...(thumbnail ? { thumbnail } : {}), ...(preview ? { preview } : {}) };
}

const num = (value: unknown) => typeof value === 'number' ? value : undefined;
const str = (value: unknown) => typeof value === 'string' ? value : undefined;

/**
 * One property, as the first of OpenAI's field shapes it matches: resource
 * selection, titled single select, titled multi-select, untitled multi-select,
 * enum, string, number, boolean, then a string array. `null` when none does.
 */
function field(name: string, raw: unknown, required: boolean): FormField | null {
  const schema = record(raw);
  if (!schema) return null;
  const common = { name, required, ...(typeof schema.title === 'string' ? { title: schema.title } : {}), ...(typeof schema.description === 'string' ? { description: schema.description } : {}) };
  const input = schema['x-openai-input'];
  const uriString = { ...stringShape, format: (v: unknown) => v === 'uri', ...noChoices };

  // Resource selection: one URI, or an array of them.
  if (input !== undefined) {
    const single = matches(schema, { ...uriString, 'x-openai-input': isFileInput(false) });
    const multiple = !single && matches(schema, { ...arrayBase, items: v => !!record(v) && matches(record(v)!, uriString), 'x-openai-input': isFileInput(true) });
    if (!single && !multiple) return null;
    const spec = record(input)!, user = record(spec.userOptions);
    const options = (spec.options as unknown[]).map(resourceOption);
    const selection = spec.selection === 'implicit' ? 'implicit' : 'explicit';
    // OpenAI's SDK refuses these: implicit selection with a default, and a default that is not an option.
    if (schema.default !== undefined) {
      if (selection === 'implicit') return null;
      const defaults = Array.isArray(schema.default) ? schema.default : [schema.default];
      if (defaults.some(uri => !options.some(option => option.uri === uri))) return null;
    }
    // Implicit selection always lets the person add their own. Without `userOptions` that is any file (OpenAI's spec).
    const userOptions: UserResourceOptions | undefined = user ? { kind: user.kind === 'directory' ? 'directory' : 'file', accept: (user.accept as string[] | undefined) ?? [] }
      : selection === 'implicit' ? { kind: 'file', accept: [] } : undefined;
    return { ...common, kind: 'resource', multiple, selection, options,
      ...(userOptions ? { userOptions } : {}),
      ...(num(schema.minItems) !== undefined ? { minItems: num(schema.minItems) } : {}), ...(num(schema.maxItems) !== undefined ? { maxItems: num(schema.maxItems) } : {}),
      ...(schema.default !== undefined ? { default: schema.default as string | string[] } : {}),
      ...(str(schema.pattern) !== undefined ? { pattern: str(schema.pattern) } : {}) };
  }

  // Titled single select (`oneOf`).
  if (matches(schema, { type: v => v === 'string', ...base, oneOf: isOptions, default: optional(isString), anyOf: absent })) {
    const options = (schema.oneOf as unknown[]).map(option);
    return { ...common, kind: 'select', options, thumbnails: options.some(o => o.thumbnail), ...(str(schema.default) !== undefined ? { default: str(schema.default) } : {}) };
  }
  // Titled multi-select (`items.anyOf`).
  const items = record(schema.items);
  if (items && matches(schema, arrayBase) && matches(items, { enum: absent, anyOf: isOptions })) {
    const options = (items.anyOf as unknown[]).map(option);
    return { ...common, kind: 'multiselect', options, thumbnails: options.some(o => o.thumbnail), ...arrayBounds(schema), ...(Array.isArray(schema.default) ? { default: schema.default as string[] } : {}) };
  }
  // Untitled multi-select (`items.enum`).
  if (items && matches(schema, arrayBase) && matches(items, { type: v => v === 'string', enum: isStrings, anyOf: absent })) {
    const options = (items.enum as string[]).map(value => ({ value, title: value }));
    return { ...common, kind: 'multiselect', options, thumbnails: false, ...arrayBounds(schema), ...(Array.isArray(schema.default) ? { default: schema.default as string[] } : {}) };
  }
  // Single select from `enum`, titled by `enumNames` when given.
  if (matches(schema, { type: v => v === 'string', ...base, enum: isStrings, enumNames: optional(isStrings), default: optional(isString), oneOf: absent, anyOf: absent })) {
    const names = schema.enumNames as string[] | undefined;
    const options = (schema.enum as string[]).map((value, index) => ({ value, title: names?.[index] ?? value }));
    return { ...common, kind: 'select', options, thumbnails: false, ...(str(schema.default) !== undefined ? { default: str(schema.default) } : {}) };
  }
  if (matches(schema, { ...stringShape, ...noChoices })) {
    return { ...common, kind: 'text', suggestions: ((schema['x-openai-suggestions'] as unknown[] | undefined) ?? []).map(option), ...stringBounds(schema),
      ...(str(schema.default) !== undefined ? { default: str(schema.default) } : {}) };
  }
  if (matches(schema, { type: v => v === 'number' || v === 'integer', ...base, minimum: optional(isNumber), maximum: optional(isNumber), default: optional(isNumber) })) {
    return { ...common, kind: 'number', integer: schema.type === 'integer',
      ...(num(schema.minimum) !== undefined ? { minimum: num(schema.minimum) } : {}), ...(num(schema.maximum) !== undefined ? { maximum: num(schema.maximum) } : {}),
      ...(num(schema.default) !== undefined ? { default: num(schema.default) } : {}) };
  }
  if (matches(schema, { type: v => v === 'boolean', ...base, default: optional(isBoolean) })) {
    return { ...common, kind: 'boolean', ...(typeof schema.default === 'boolean' ? { default: schema.default } : {}) };
  }
  // Free-form strings, each with the string field's constraints and suggestions.
  if (items && matches(schema, { ...arrayBase, uniqueItems: optional(isBoolean) }) && matches(items, { ...stringShape, ...noChoices })) {
    return { ...common, kind: 'texts', item: stringBounds(items), suggestions: ((items['x-openai-suggestions'] as unknown[] | undefined) ?? []).map(option),
      uniqueItems: schema.uniqueItems === true, ...arrayBounds(schema), ...(Array.isArray(schema.default) ? { default: schema.default as string[] } : {}) };
  }
  return null;
}
function arrayBounds(schema: Record<string, unknown>) {
  return { ...(num(schema.minItems) !== undefined ? { minItems: num(schema.minItems) } : {}), ...(num(schema.maxItems) !== undefined ? { maxItems: num(schema.maxItems) } : {}) };
}
function stringBounds(schema: Record<string, unknown>) {
  return {
    ...(typeof schema.format === 'string' ? { format: schema.format as StringFormat } : {}),
    ...(num(schema.minLength) !== undefined ? { minLength: num(schema.minLength) } : {}), ...(num(schema.maxLength) !== undefined ? { maxLength: num(schema.maxLength) } : {}),
    ...(str(schema.pattern) !== undefined ? { pattern: str(schema.pattern) } : {}),
  };
}

/** Read a requested schema into fields, or say which field makes it unsupported. */
export function parseForm(schema: unknown): FormParse {
  const form = record(schema);
  if (!form || form.type !== 'object' || !optional(isString)(form.$schema) || !optional(isStrings)(form.required)) {
    return { ok: false, reason: 'The form is not an object schema.' };
  }
  const properties = form.properties === undefined ? {} : record(form.properties);
  if (!properties) return { ok: false, reason: 'The form has no fields Ri can read.' };
  const required = new Set((form.required as string[] | undefined) ?? []);
  const fields: FormField[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    const parsed = field(name, raw, required.has(name));
    if (!parsed) {
      const title = typeof record(raw)?.title === 'string' ? record(raw)!.title as string : name;
      return { ok: false, reason: `"${title}" uses an input type Ri does not support.` };
    }
    // A pattern that is not a valid regular expression would make the field impossible to fill.
    const {own, items} = propertyPatterns(raw);
    for (const pattern of [own, items]) if (pattern !== undefined && !validPattern(pattern)) return { ok: false, reason: `"${parsed.title ?? name}" has a pattern Ri cannot check.` };
    fields.push(parsed);
  }
  return { ok: true, form: { fields, schema: form, hasResources: fields.some(f => f.kind === 'resource') } };
}

/** The patterns a property's value is held to: its own, for a text value, and its items', for a list. */
function propertyPatterns(raw: unknown): { own?: string; items?: string } {
  const schema = record(raw);
  return { own: str(schema?.pattern), items: str(record(schema?.items)?.pattern) };
}

const SUBSCHEMA = new Set(['items', 'additionalItems', 'contains', 'additionalProperties', 'propertyNames', 'not', 'if', 'then', 'else', 'unevaluatedItems', 'unevaluatedProperties', 'prefixItems', 'allOf', 'anyOf', 'oneOf']);
const SUBSCHEMA_MAP = new Set(['properties', '$defs', 'definitions', 'dependentSchemas']);
/**
 * A schema without `pattern` and `patternProperties`, wherever a subschema
 * can hold them, for the validator, which would run them in JavaScript's
 * backtracking engine. Values (`enum`, `const`, `default`, suggestions) and
 * property names, including one named `pattern`, are left as they are.
 */
function withoutPatterns(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutPatterns);
  const object = record(schema);
  if (!object) return schema;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (key === 'pattern' || key === 'patternProperties') continue;
    const map = SUBSCHEMA_MAP.has(key) ? record(value) : undefined;
    copy[key] = map ? Object.fromEntries(Object.entries(map).map(([name, child]) => [name, withoutPatterns(child)]))
      : SUBSCHEMA.has(key) ? withoutPatterns(value) : value;
  }
  return copy;
}

/** The answer each field starts with: its default, every option for implicit selection, or nothing. */
export function initialValues(form: ParsedForm): Partial<FormContent> {
  const values: Partial<FormContent> = {};
  for (const f of form.fields) {
    if (f.kind === 'resource' && f.multiple && f.selection === 'implicit') values[f.name] = f.options.map(o => o.uri);
    else if ('default' in f && f.default !== undefined) values[f.name] = f.default;
  }
  return values;
}

/** The submitted content: every answered field, without empty optional ones. */
export function formContent(form: ParsedForm, values: Partial<FormContent>): FormContent {
  const content: FormContent = {};
  for (const f of form.fields) {
    const value = values[f.name];
    if (value === undefined || (value === '' && !f.required)) continue;
    if (Array.isArray(value) && !value.length && !f.required && f.kind !== 'resource') continue;
    content[f.name] = value;
  }
  return content;
}

/** HTML `accept`: `.ext`, `type/subtype` or `type/*`. An empty list accepts any file. */
export function acceptsFile(accept: readonly string[], name: string, mimeType?: string) {
  if (!accept.length) return true;
  const lower = name.toLowerCase(), mime = mimeType?.toLowerCase();
  return accept.some(raw => {
    const rule = raw.trim().toLowerCase();
    if (rule.startsWith('.')) return lower.endsWith(rule);
    if (!mime) return false;
    return rule.endsWith('/*') ? mime.startsWith(rule.slice(0, -1)) : mime === rule;
  });
}

const FRIENDLY: Record<string, (f: FormField | undefined) => string> = {
  pattern: () => 'This does not match the expected format.',
  format: f => f && (f.kind === 'text' || f.kind === 'resource') && (f.kind === 'resource' || f.format === 'uri') ? 'Enter a valid address.' : 'This is not in the expected format.',
  minLength: f => f?.kind === 'text' && f.minLength !== undefined ? `Use at least ${f.minLength} character${f.minLength === 1 ? '' : 's'}.` : 'This is too short.',
  maxLength: f => f?.kind === 'text' && f.maxLength !== undefined ? `Use at most ${f.maxLength} characters.` : 'This is too long.',
  minimum: f => f?.kind === 'number' && f.minimum !== undefined ? `Use ${f.minimum} or more.` : 'This is too small.',
  maximum: f => f?.kind === 'number' && f.maximum !== undefined ? `Use ${f.maximum} or less.` : 'This is too large.',
  minItems: f => f && 'minItems' in f && f.minItems !== undefined ? `Choose at least ${f.minItems}.` : 'Choose more.',
  maxItems: f => f && 'maxItems' in f && f.maxItems !== undefined ? `Choose at most ${f.maxItems}.` : 'Choose fewer.',
  uniqueItems: () => 'Each value can appear once.',
  type: f => f?.kind === 'number' ? (f.integer ? 'Enter a whole number.' : 'Enter a number.') : 'This value has the wrong type.',
  enum: () => 'Choose one of the options.',
  const: () => 'Choose one of the options.',
  anyOf: () => 'Choose from the options.',
  oneOf: () => 'Choose one of the options.',
};

/**
 * What is wrong with an answer, by field (`''` for the form as a whole). Empty
 * when it is valid. The JSON Schema check is the one OpenAI's SDK runs,
 * required fields are checked by name, and a resource field must name one of
 * its options unless selection is implicit or the person may add their own.
 */
export function formErrors(form: ParsedForm, content: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  const fields = new Map(form.fields.map(f => [f.name, f]));
  for (const [name, value] of Object.entries(content)) {
    if (!fields.has(name)) { errors[''] = 'The answer names a field the form does not have.'; continue; }
    const valid = typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (Array.isArray(value) && value.every(item => typeof item === 'string'));
    if (!valid) errors[name] = 'This value has the wrong type.';
  }
  const validator = new Validator(structuredClone(withoutPatterns(form.schema)) as Schema, '2020-12', false);
  // The validator uses `in`, so inherited names must not count as submitted fields.
  for (const error of validator.validate(Object.setPrototypeOf({ ...content }, null)).errors) {
    if (error.keywordLocation === '#/required') continue;
    const [name] = error.instanceLocation.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (name === undefined) { if (error.keyword !== 'properties') errors[''] ??= 'The answer does not fit the form.'; continue; }
    if (errors[name]) continue;
    // `properties` and `items` only say a nested keyword failed. Its own error carries the reason.
    if (error.keyword === 'properties' || error.keyword === 'items' || error.keyword === 'prefixItems') continue;
    errors[name] = (FRIENDLY[error.keyword] ?? (() => 'This value is not accepted.'))(fields.get(name));
  }
  // Patterns, in linear time. One Ri cannot run that way, or a value too long to check, is left to the server.
  const properties = record(record(form.schema)?.properties) ?? {};
  for (const [name, value] of Object.entries(content)) {
    if (errors[name] || !fields.has(name)) continue;
    const {own, items} = propertyPatterns(properties[name]);
    const checks: [string, string][] = typeof value === 'string' ? (own === undefined ? [] : [[own, value]])
      : Array.isArray(value) && items !== undefined ? value.filter((item): item is string => typeof item === 'string').map(item => [items, item]) : [];
    if (checks.some(([pattern, text]) => matchesPattern(pattern, text) === false)) errors[name] = FRIENDLY.pattern(fields.get(name));
  }
  for (const f of form.fields) {
    if (f.required && !Object.hasOwn(content, f.name)) errors[f.name] ??= 'This is required.';
    if (f.kind !== 'resource' || !Object.hasOwn(content, f.name)) continue;
    const chosen = content[f.name];
    const uris = Array.isArray(chosen) ? chosen : [chosen];
    if (!(f.userOptions || uris.every(uri => f.options.some(option => option.uri === uri)))) errors[f.name] ??= 'Choose from the listed items.';
  }
  return errors;
}
