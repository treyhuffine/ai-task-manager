import { safeMcpIcon, type McpIcon } from '@/lib/integrations/mcp-icons';

/**
 * The forms an MCP server can ask a person to fill: MCP's form elicitation
 * and OpenAI's extended forms (openai/mcp-extensions docs/spec.md, "OpenAI
 * Form Elicitation"). Shared by the Home, which checks a form can be shown,
 * and the browser, which renders it.
 *
 * `parseForm` accepts exactly the field shapes OpenAI's SDK accepts
 * (typescript/src/shared/forms), tried in the same order, and refuses the
 * whole form when one field matches none: OpenAI's spec reports such a form
 * as unsupported rather than showing part of it. Unknown keys are ignored, as
 * the SDK's schemas strip them. A field's shape decides only which control
 * shows it. Ri never checks an answer against the schema (required fields,
 * types, bounds, patterns): the server validates its own form, and when it
 * asks again Ri brings back what the person entered (`elicitation.ts`).
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

/** `required` only marks the field for the person. The server decides what it needs. */
interface FieldBase { name: string; title?: string; description?: string; required: boolean }
export type FormField = FieldBase & (
  | { kind: 'text'; format?: StringFormat; default?: string; suggestions: FormOption[] }
  | { kind: 'number'; integer: boolean; default?: number }
  | { kind: 'boolean'; default?: boolean }
  /** One of a fixed list: titled `oneOf`, or `enum` with optional `enumNames`. */
  | { kind: 'select'; options: FormOption[]; default?: string; thumbnails: boolean }
  /** Several of a fixed list: titled `items.anyOf`, or `items.enum`. */
  | { kind: 'multiselect'; options: FormOption[]; default?: string[]; thumbnails: boolean }
  /** Free-form strings, with optional suggestions. */
  | { kind: 'texts'; item: { format?: StringFormat }; suggestions: FormOption[]; default?: string[] }
  /** OpenAI's resource selection (`x-openai-input`), one URI or several. */
  | { kind: 'resource'; multiple: boolean; selection: 'explicit' | 'implicit'; options: ResourceOption[]; userOptions?: UserResourceOptions; default?: string | string[] }
);
export type FieldKind = FormField['kind'];

export interface ParsedForm {
  fields: FormField[];
  /** The requested schema as sent, which the browser reads again to render the form. */
  schema: Record<string, unknown>;
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
/** OpenAI's extended StringSchema: MCP's, plus `pattern` (accepted, never run) and suggestions. */
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
      ...(schema.default !== undefined ? { default: schema.default as string | string[] } : {}) };
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
    return { ...common, kind: 'multiselect', options, thumbnails: options.some(o => o.thumbnail), ...(Array.isArray(schema.default) ? { default: schema.default as string[] } : {}) };
  }
  // Untitled multi-select (`items.enum`).
  if (items && matches(schema, arrayBase) && matches(items, { type: v => v === 'string', enum: isStrings, anyOf: absent })) {
    const options = (items.enum as string[]).map(value => ({ value, title: value }));
    return { ...common, kind: 'multiselect', options, thumbnails: false, ...(Array.isArray(schema.default) ? { default: schema.default as string[] } : {}) };
  }
  // Single select from `enum`, titled by `enumNames` when given.
  if (matches(schema, { type: v => v === 'string', ...base, enum: isStrings, enumNames: optional(isStrings), default: optional(isString), oneOf: absent, anyOf: absent })) {
    const names = schema.enumNames as string[] | undefined;
    const options = (schema.enum as string[]).map((value, index) => ({ value, title: names?.[index] ?? value }));
    return { ...common, kind: 'select', options, thumbnails: false, ...(str(schema.default) !== undefined ? { default: str(schema.default) } : {}) };
  }
  if (matches(schema, { ...stringShape, ...noChoices })) {
    return { ...common, kind: 'text', suggestions: ((schema['x-openai-suggestions'] as unknown[] | undefined) ?? []).map(option), ...stringFormat(schema),
      ...(str(schema.default) !== undefined ? { default: str(schema.default) } : {}) };
  }
  if (matches(schema, { type: v => v === 'number' || v === 'integer', ...base, minimum: optional(isNumber), maximum: optional(isNumber), default: optional(isNumber) })) {
    return { ...common, kind: 'number', integer: schema.type === 'integer',
      ...(num(schema.default) !== undefined ? { default: num(schema.default) } : {}) };
  }
  if (matches(schema, { type: v => v === 'boolean', ...base, default: optional(isBoolean) })) {
    return { ...common, kind: 'boolean', ...(typeof schema.default === 'boolean' ? { default: schema.default } : {}) };
  }
  // Free-form strings, each with the string field's suggestions.
  if (items && matches(schema, { ...arrayBase, uniqueItems: optional(isBoolean) }) && matches(items, { ...stringShape, ...noChoices })) {
    return { ...common, kind: 'texts', item: stringFormat(items), suggestions: ((items['x-openai-suggestions'] as unknown[] | undefined) ?? []).map(option),
      ...(Array.isArray(schema.default) ? { default: schema.default as string[] } : {}) };
  }
  return null;
}
/** A string's `format`, which picks its control (email, address, date, date and time). */
function stringFormat(schema: Record<string, unknown>) {
  return typeof schema.format === 'string' ? { format: schema.format as StringFormat } : {};
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
    fields.push(parsed);
  }
  return { ok: true, form: { fields, schema: form } };
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

/**
 * The submitted content: what the person entered, field by field. A field
 * left empty is left out, except a resource selection, where an empty list
 * says the person removed every item. Nothing is checked here: the server
 * says what it needs.
 */
export function formContent(form: ParsedForm, values: Partial<FormContent>): FormContent {
  const content: FormContent = {};
  for (const f of form.fields) {
    const value = values[f.name];
    if (value === undefined || value === '') continue;
    if (Array.isArray(value) && !value.length && f.kind !== 'resource') continue;
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
