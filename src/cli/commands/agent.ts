/**
 * `<cli> agent <action> [params]` — agent orchestrator CLI surface.
 *
 * Subcommands are auto-generated from `src/lib/orchestrator/registry.ts`.
 * Adding a new action there wires it up here automatically.
 *
 * Conventions:
 *  - Positional args are declared in the action's `cli.positional` list and
 *    consumed in order.
 *  - Every other param is a `--snake_case` flag. Strings, numbers, booleans,
 *    and enums parse straight; arrays and objects accept JSON strings.
 *  - Output is always JSON on stdout for easy piping (`| jq`). Errors print
 *    to stderr and exit with code 1.
 *  - `--input @-` or `--input path.json` reads a JSON blob as the full input,
 *    merged on top of any positional/flag values. This is the agent-friendly
 *    path — hand the action the full params in one blob.
 */

import fs from 'node:fs';
import { Command } from 'commander';
import type { z } from 'zod';
import { actions } from '@/lib/orchestrator/registry';
import { runAction } from '@/lib/orchestrator/dispatch';
import type { Action } from '@/lib/orchestrator/types';

export function registerAgentCommand(program: Command) {
  const agent = program
    .command('agent')
    .description(
      `Agent orchestrator surface. Typed, auto-generated CLI twin of the orchestrator MCP.`,
    );

  for (const action of actions) {
    const positional = (action.cli?.positional ?? []) as string[];
    const positionalSet = new Set(positional);
    const posArgs = positional.map((p) => `<${p}>`).join(' ');

    const cmd = agent
      .command(`${action.name}${posArgs ? ' ' + posArgs : ''}`)
      .description(action.description)
      .option(
        '--input <json-or-@file>',
        'Full input as JSON. "@-" reads stdin. "@path.json" reads a file. Merged on top of flag/positional values.',
      );

    for (const [paramName, paramSchema] of Object.entries(action.params) as Array<
      [string, z.ZodTypeAny]
    >) {
      if (positionalSet.has(paramName)) continue;
      const flag = `--${paramName.replace(/_/g, '-')}`;
      cmd.option(`${flag} <value>`, describeParam(paramSchema));
    }

    cmd.action(async (...args) => {
      const cmdInstance = args[args.length - 1] as Command;
      const opts = cmdInstance.opts() as Record<string, string | undefined>;
      const positionalValues = args.slice(0, positional.length) as string[];

      const input: Record<string, unknown> = {};
      positional.forEach((name, i) => {
        if (positionalValues[i] !== undefined) input[name] = positionalValues[i];
      });
      for (const [paramName, paramSchema] of Object.entries(action.params) as Array<
        [string, z.ZodTypeAny]
      >) {
        if (positionalSet.has(paramName)) continue;
        const flagKey = paramName.replace(/_/g, '');
        // commander lowercases + strips dashes for camelCase option keys
        const camel = paramName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        const raw = opts[camel] ?? opts[flagKey];
        if (raw === undefined) continue;
        input[paramName] = coerceFlag(raw, paramSchema);
      }

      if (opts.input) {
        const blob = readInputBlob(opts.input);
        Object.assign(input, blob);
      }

      const envelope = await runAction(action.name, input, { remote: false });
      if (!envelope.ok) {
        process.stderr.write(JSON.stringify(envelope, null, 2) + '\n');
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(envelope.result, null, 2) + '\n');
    });
  }

  return agent;
}

function readInputBlob(ref: string): Record<string, unknown> {
  const raw = ref === '@-'
    ? fs.readFileSync(0, 'utf8')
    : ref.startsWith('@')
      ? fs.readFileSync(ref.slice(1), 'utf8')
      : ref;
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--input must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Coerce a string flag value toward the schema's expected type. We don't try
 * to be clever — Zod does the real validation in dispatch. This just handles
 * the common cases so users don't have to JSON-quote everything.
 */
function coerceFlag(raw: string, schema: z.ZodTypeAny): unknown {
  const def = unwrap(schema);
  const typeName = (def as { _def?: { typeName?: string } })._def?.typeName;
  if (typeName === 'ZodNumber') return Number(raw);
  if (typeName === 'ZodBoolean') return raw === 'true' || raw === '1';
  if (typeName === 'ZodArray' || typeName === 'ZodObject' || typeName === 'ZodUnion') {
    try {
      return JSON.parse(raw);
    } catch {
      return typeName === 'ZodArray' ? raw.split(',').map((s) => s.trim()) : raw;
    }
  }
  return raw;
}

/** Peel optional/nullable wrappers to get the underlying schema. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  const inner = (schema as unknown as { _def?: { innerType?: z.ZodTypeAny } })._def?.innerType;
  return inner ? unwrap(inner) : schema;
}

function describeParam(schema: z.ZodTypeAny): string {
  const def = unwrap(schema);
  const typeName = (def as { _def?: { typeName?: string } })._def?.typeName;
  const hint =
    typeName === 'ZodArray'
      ? 'array: JSON or comma-separated'
      : typeName === 'ZodObject'
        ? 'object: JSON'
        : typeName === 'ZodNumber'
          ? 'number'
          : typeName === 'ZodBoolean'
            ? 'boolean'
            : typeName === 'ZodEnum'
              ? `enum: ${((def as unknown as { options?: string[] }).options ?? []).join('|')}`
              : 'string';
  return hint;
}
