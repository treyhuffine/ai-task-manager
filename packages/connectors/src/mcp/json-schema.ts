/**
 * Minimal JSON-Schema → Zod converter for ingested MCP tool input schemas (§12).
 *
 * The engine is zod-only (no json-schema lib), and MCP tool `inputSchema`s are a small,
 * well-behaved JSON Schema subset (object with typed properties + required). We convert that to a
 * ZodObject so the ingested action carries a real schema — which both projections (serveMcp's
 * `.shape`, toToolSet's `a.input`) surface to the model, instead of a blank catchall that makes
 * the agent guess argument names.
 *
 * Philosophy: faithful where we understand the node, permissive where we don't. Anything exotic
 * (oneOf/anyOf/$ref/unknown type) becomes `z.unknown()` (accepts anything — the remote server is
 * the real validator), and the object passes unknown keys through rather than stripping them.
 */
import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

function asSchema(v: unknown): JsonSchema | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonSchema) : null;
}

function describe(zt: z.ZodTypeAny, node: JsonSchema): z.ZodTypeAny {
  const d = node.description;
  return typeof d === 'string' && d ? zt.describe(d) : zt;
}

function typeOf(node: JsonSchema): string | undefined {
  const t = node.type;
  return Array.isArray(t) ? (t[0] as string | undefined) : (t as string | undefined);
}

function nodeToZod(node: JsonSchema): z.ZodTypeAny {
  // enum / const → literal(s)
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const lits = node.enum.map((v) => z.literal(v as string | number | boolean));
    const u =
      lits.length === 1 ? lits[0]! : z.union(lits as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
    return describe(u, node);
  }
  if ('const' in node) return describe(z.literal(node.const as string | number | boolean), node);

  switch (typeOf(node)) {
    case 'string':
      return describe(z.string(), node);
    case 'integer':
    case 'number':
      return describe(z.number(), node);
    case 'boolean':
      return describe(z.boolean(), node);
    case 'null':
      return describe(z.null(), node);
    case 'array': {
      const items = asSchema(node.items);
      return describe(z.array(items ? nodeToZod(items) : z.unknown()), node);
    }
    case 'object':
      return describe(objectToZod(node), node);
    default:
      // unknown / oneOf / anyOf / $ref / missing type → accept anything; the remote validates.
      return describe(z.unknown(), node);
  }
}

function objectToZod(node: JsonSchema): z.ZodObject<z.ZodRawShape> {
  const props = asSchema(node.properties) ?? {};
  const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
  const shape: z.ZodRawShape = {};
  for (const [key, raw] of Object.entries(props)) {
    const sub = asSchema(raw);
    let zt = sub ? nodeToZod(sub) : z.unknown();
    if (!required.has(key)) zt = zt.optional();
    shape[key] = zt;
  }
  // Pass unknown keys through (the remote server is the source of truth), don't strip/reject.
  return z.object(shape).passthrough();
}

/**
 * Convert an MCP tool `inputSchema` into a ZodObject for the engine action. Always returns an
 * object (the engine requires action input to be a ZodObject); a non-object or absent schema
 * becomes a permissive `z.object({}).passthrough()` (the prior behavior).
 */
export function jsonSchemaToZodObject(schema: unknown): z.ZodObject<z.ZodRawShape> {
  const node = asSchema(schema);
  if (!node) return z.object({}).passthrough();
  if (typeOf(node) === 'object' || node.properties) return objectToZod(node);
  return z.object({}).passthrough();
}
