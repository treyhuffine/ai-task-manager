#!/usr/bin/env node
/**
 * Generate the X (Twitter) connector's operation manifest from the X API v2 OpenAPI spec — the same
 * spec XMCP loads (https://api.x.com/2/openapi.json), distilled at build time into committed,
 * reviewable descriptors that the runtime toolkit builder turns into engine actions.
 *
 * Reads the vendored spec by default (reproducible/offline). Pass --fetch to refresh it from X.
 *
 *   node scripts/gen-twitter-toolkit.mjs            # generate from vendored spec
 *   node scripts/gen-twitter-toolkit.mjs --fetch    # re-vendor the spec, then generate
 *
 * Output: packages/connectors/src/providers/twitter/operations.generated.ts
 *
 * Parity with XMCP: excludes the Stream + Webhooks tags, /stream + /webhooks paths, and any
 * operation flagged `x-twitter-streaming`. Tool ids derive from `operationId`. Array query params
 * are comma-joined at request time (X uses explode:false). Auth differs deliberately: we use the
 * spec's OAuth2 user-context scheme (our engine does OAuth2 + refresh natively) rather than OAuth1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPEC_URL = 'https://api.x.com/2/openapi.json';
const SPEC_PATH = join(ROOT, 'packages/connectors/src/providers/twitter/vendor/x-openapi.json');
const OUT_PATH = join(ROOT, 'packages/connectors/src/providers/twitter/operations.generated.ts');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const EXCLUDED_TAGS = new Set(['Stream', 'Webhooks']);
const MAX_DEPTH = 4; // bound schema recursion (X schemas are deep + self-referential)

async function loadSpec() {
  if (process.argv.includes('--fetch')) {
    process.stderr.write(`Fetching ${SPEC_URL} ...\n`);
    const res = await fetch(SPEC_URL);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const text = await res.text();
    writeFileSync(SPEC_PATH, text);
    return JSON.parse(text);
  }
  return JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
}

/** Resolve a single local `#/...` JSON Pointer against the spec. Returns null for external refs. */
function resolveRef(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let node = spec;
  for (const seg of ref.slice(2).split('/')) {
    const key = seg.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node == null || typeof node !== 'object') return null;
    node = node[key];
  }
  return node ?? null;
}

/** Deref one `$ref` level, returning { node, refName } (refName for cycle tracking). */
function deref(spec, node) {
  if (node && typeof node === 'object' && typeof node.$ref === 'string') {
    return { node: resolveRef(spec, node.$ref), refName: node.$ref };
  }
  return { node, refName: null };
}

function firstType(t) {
  if (Array.isArray(t)) return t.find((x) => x !== 'null') ?? t[0];
  return t;
}

/**
 * Distill a JSON Schema node into a clean, self-contained subset (type / enum / description /
 * properties / required / items), resolving $refs with a depth bound + cycle guard. Anything we
 * can't faithfully represent collapses to a permissive `{}` (the engine's json-schema → zod
 * converter then treats it as accept-anything; the X API is the real validator).
 */
function simplify(spec, raw, depth, seen) {
  const { node, refName } = deref(spec, raw);
  if (!node || typeof node !== 'object') return {};
  if (refName) {
    if (seen.has(refName)) return {}; // cycle → permissive
    seen = new Set(seen).add(refName);
  }
  const out = {};
  if (typeof node.description === 'string' && node.description) out.description = node.description;

  // allOf → shallow-merge object members (X uses it occasionally for request bodies).
  if (Array.isArray(node.allOf)) {
    const merged = { type: 'object', properties: {}, required: [] };
    for (const sub of node.allOf) {
      const s = simplify(spec, sub, depth, seen);
      if (s.properties) Object.assign(merged.properties, s.properties);
      if (Array.isArray(s.required)) merged.required.push(...s.required);
    }
    if (Object.keys(merged.properties).length) {
      return { ...out, type: 'object', properties: merged.properties, required: [...new Set(merged.required)] };
    }
    return out; // permissive
  }

  if (Array.isArray(node.enum) && node.enum.length) {
    out.enum = node.enum;
    return out;
  }

  const type = firstType(node.type);
  if (depth <= 0) {
    if (type) out.type = type;
    return out;
  }

  switch (type) {
    case 'string':
    case 'integer':
    case 'number':
    case 'boolean':
    case 'null':
      out.type = type;
      return out;
    case 'array':
      out.type = 'array';
      out.items = node.items ? simplify(spec, node.items, depth - 1, seen) : {};
      return out;
    case 'object': {
      out.type = 'object';
      out.properties = {};
      const props = node.properties && typeof node.properties === 'object' ? node.properties : {};
      for (const [k, v] of Object.entries(props)) out.properties[k] = simplify(spec, v, depth - 1, seen);
      const req = Array.isArray(node.required) ? node.required.filter((r) => r in out.properties) : [];
      if (req.length) out.required = req;
      return out;
    }
    default:
      // No type / oneOf / anyOf → permissive (but keep object props if present).
      if (node.properties && typeof node.properties === 'object') {
        out.type = 'object';
        out.properties = {};
        for (const [k, v] of Object.entries(node.properties)) out.properties[k] = simplify(spec, v, depth - 1, seen);
      }
      return out;
  }
}

function camelToSnake(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
}

/** Pull the OAuth2 user-context scopes from an operation's security requirements. */
function oauthScopes(op) {
  const set = new Set();
  for (const req of op.security ?? []) {
    const s = req?.OAuth2UserToken;
    if (Array.isArray(s)) for (const sc of s) set.add(sc);
  }
  return [...set].sort();
}

function riskFor(method) {
  if (method === 'GET') return 'low';
  if (method === 'DELETE') return 'high';
  return 'medium';
}

function buildOp(spec, path, method, item, op) {
  const upper = method.toUpperCase();
  const params = [...(item.parameters ?? []), ...(op.parameters ?? [])]
    .map((p) => deref(spec, p).node)
    .filter((p) => p && typeof p === 'object' && p.name && p.in);

  const properties = {};
  const required = [];
  const pathParams = [];
  for (const p of params) {
    if (p.in !== 'path' && p.in !== 'query') continue; // header/cookie params are auth-managed
    const schema = simplify(spec, p.schema ?? {}, MAX_DEPTH, new Set());
    if (typeof p.description === 'string' && p.description && !schema.description) schema.description = p.description;
    properties[p.name] = schema;
    if (p.in === 'path') pathParams.push(p.name);
    if (p.required) required.push(p.name);
  }

  let bodyParams = [];
  let bodyRoot = false;
  const bodyRef = op.requestBody ? deref(spec, op.requestBody).node : null;
  const jsonSchema = bodyRef?.content?.['application/json']?.schema;
  if (jsonSchema) {
    const body = simplify(spec, jsonSchema, MAX_DEPTH, new Set());
    if (body.type === 'object' && body.properties) {
      for (const [k, v] of Object.entries(body.properties)) properties[k] = v;
      bodyParams = Object.keys(body.properties);
      if (Array.isArray(body.required)) required.push(...body.required.filter((r) => r in properties));
    } else {
      // Non-object body (rare) → a single `body` field carrying the whole payload.
      properties.body = body;
      bodyParams = ['body'];
      bodyRoot = true;
      if (bodyRef.required) required.push('body');
    }
  }

  return {
    id: `twitter.${camelToSnake(op.operationId)}`,
    operationId: op.operationId,
    method: upper,
    path,
    description: (op.summary || op.description || op.operationId).trim().replace(/\s+/g, ' ').slice(0, 300),
    tags: (op.tags ?? []).filter((t) => typeof t === 'string'),
    scopes: oauthScopes(op),
    mutating: upper !== 'GET',
    risk: riskFor(upper),
    pathParams,
    bodyParams,
    bodyRoot,
    inputSchema: { type: 'object', properties, required: [...new Set(required)] },
  };
}

async function main() {
  const spec = await loadSpec();
  const ops = [];
  const ids = new Set();
  const stats = { total: 0, excludedStreaming: 0, excludedWebhooks: 0, included: 0 };
  const scopeUnion = new Set();

  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of Object.keys(item)) {
      if (!METHODS.includes(method)) continue;
      const op = item[method];
      stats.total++;
      // Mirror XMCP's should_exclude_operation exactly (case-insensitive tag match).
      const tags = (op.tags ?? []).filter((t) => typeof t === 'string').map((t) => t.toLowerCase());
      if (op['x-twitter-streaming'] === true || path.includes('/stream') || tags.includes('stream')) {
        stats.excludedStreaming++;
        continue;
      }
      if (path.includes('/webhooks') || tags.includes('webhooks')) {
        stats.excludedWebhooks++;
        continue;
      }
      if (!op.operationId) continue;
      const built = buildOp(spec, path, method, item, op);
      if (ids.has(built.id)) throw new Error(`duplicate action id ${built.id} (operationId ${op.operationId})`);
      ids.add(built.id);
      for (const s of built.scopes) scopeUnion.add(s);
      ops.push(built);
      stats.included++;
    }
  }

  ops.sort((a, b) => a.id.localeCompare(b.id));
  const scopes = [...scopeUnion].sort();

  const header = `/**
 * AUTO-GENERATED — do not edit by hand.
 * Source: X API v2 OpenAPI ${spec.info?.version ?? '?'} (${SPEC_URL})
 * Generator: scripts/gen-twitter-toolkit.mjs
 * ${ops.length} operations (Stream + Webhooks excluded for parity with XMCP).
 */
/* eslint-disable */

export interface TwitterOp {
  /** Action id (public contract): \`twitter.<snake_case(operationId)>\`. */
  id: string;
  /** Original X OpenAPI operationId (XMCP's tool name). */
  operationId: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path template against base \`https://api.x.com\`; \`{param}\` placeholders filled from input. */
  path: string;
  description: string;
  /** X OpenAPI tags (e.g. Tweets, Users) — used by the optional tag filter (XMCP X_API_TOOL_TAGS). */
  tags: string[];
  /** OAuth2 user-context scopes this operation requires. */
  scopes: string[];
  mutating: boolean;
  risk: 'low' | 'medium' | 'high';
  /** Input keys substituted into the path. */
  pathParams: string[];
  /** Input keys assembled into the JSON request body. */
  bodyParams: string[];
  /** When true, the single \`body\` input IS the whole request body (non-object payload). */
  bodyRoot: boolean;
  /** JSON Schema (object) for the merged path + query + body input. */
  inputSchema: Record<string, unknown>;
}

/** Union of every operation's OAuth2 scopes — the connector's full consent surface. */
export const TWITTER_OAUTH_SCOPES: string[] = ${JSON.stringify(scopes)};

export const TWITTER_OPS: TwitterOp[] = [
`;

  const body = ops.map((op) => '  ' + JSON.stringify(op)).join(',\n');
  writeFileSync(OUT_PATH, header + body + '\n];\n');

  process.stderr.write(
    `Generated ${OUT_PATH}\n` +
      `  total operations:   ${stats.total}\n` +
      `  excluded (stream):  ${stats.excludedStreaming}\n` +
      `  excluded (webhook): ${stats.excludedWebhooks}\n` +
      `  included:           ${stats.included}\n` +
      `  oauth2 scopes:      ${scopes.length} → ${scopes.join(' ')}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`gen-twitter-toolkit failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
