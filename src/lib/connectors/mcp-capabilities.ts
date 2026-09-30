import { createHash } from 'node:crypto';

export interface McpCapabilityTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}
const FIELDS = ['title', 'description', 'inputSchema', 'outputSchema', 'annotations'] as const;
export type McpCapabilityField = typeof FIELDS[number];
export interface McpCapabilitySnapshot {
  revision: string;
  tools: (McpCapabilityTool & { fingerprint: string })[];
}
export interface McpCapabilityChanges {
  revision: string;
  added: string[];
  removed: string[];
  changed: { name: string; fields: McpCapabilityField[] }[];
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
// These schema/permission collections are sets. Tuple schemas, examples, and
// other ordered arrays keep their order because reordering can change meaning.
const SET_FIELDS = new Set(['required', 'enum', 'allOf', 'anyOf', 'oneOf', 'type', 'scopes', 'permissions']);
function canonical(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const items = value.map(item => canonical(item) ?? null);
    return SET_FIELDS.has(key) ? items.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))) : items;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => compare(a, b))
    .map(([name, item]) => [name, canonical(item, name)]));
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('A tool capability contains invalid JSON.');
}

/** Only advertised definitions enter snapshots, never credentials or tool results. */
export function snapshotMcpCapabilities(input: readonly McpCapabilityTool[]): McpCapabilitySnapshot {
  const seen = new Set<string>();
  const tools = input.map(tool => {
    if (!tool.name || seen.has(tool.name)) throw new Error('Tool capability names must be unique and nonempty.');
    seen.add(tool.name);
    const definition = canonical({ name: tool.name, ...Object.fromEntries(FIELDS.filter(field => tool[field] !== undefined).map(field => [field, tool[field]])) }) as McpCapabilityTool;
    return { ...definition, fingerprint: hash(definition) };
  }).sort((a, b) => compare(a.name, b.name));
  return { revision: hash(tools), tools };
}

export function diffMcpCapabilities(reviewed: McpCapabilitySnapshot, current: McpCapabilitySnapshot): McpCapabilityChanges | undefined {
  if (reviewed.revision === current.revision) return undefined;
  const before = new Map(reviewed.tools.map(tool => [tool.name, tool]));
  const after = new Map(current.tools.map(tool => [tool.name, tool]));
  return {
    revision: current.revision,
    added: current.tools.filter(tool => !before.has(tool.name)).map(tool => tool.name),
    removed: reviewed.tools.filter(tool => !after.has(tool.name)).map(tool => tool.name),
    changed: current.tools.flatMap(tool => {
      const previous = before.get(tool.name);
      if (!previous || previous.fingerprint === tool.fingerprint) return [];
      return [{ name: tool.name, fields: FIELDS.filter(field => JSON.stringify(previous[field]) !== JSON.stringify(tool[field])) }];
    }),
  };
}
