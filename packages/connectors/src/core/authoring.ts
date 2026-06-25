/**
 * The authoring API (§4) — the open-source contribution surface. A simple action
 * is ~5 lines; connectors grow with capabilities, not ceremony. `httpAction` is
 * the config-first path for ordinary REST; `action` is the escape hatch for real
 * logic. Both compile to the same `Action`.
 *
 * The helpers are generic over the Zod schema and infer the *parsed* (output)
 * input type, so `.default()`/`.optional()` fields are handled correctly — the
 * handler always sees post-parse values.
 */
import type { z } from 'zod';
import type { Action, ActionContext, HttpRequest, Provider, RiskLevel, Toolkit } from './types';

export function defineProvider(provider: Provider): Provider {
  return provider;
}

export function defineToolkit(toolkit: Toolkit): Toolkit {
  // The upfront-consent bundle defaults to the union of the actions' scopes (§3), so a
  // host that connects a whole toolkit requests exactly what its actions need — no
  // hand-maintained list to drift out of sync (the bug behind P2-b).
  if (toolkit.scopes) return toolkit;
  const scopes = [...new Set(toolkit.actions.flatMap((a) => a.scopes ?? []))];
  return { ...toolkit, scopes };
}

export interface ActionSpec<S extends z.ZodTypeAny, O> {
  id: string;
  description: string;
  input: S;
  output?: z.ZodType<O>;
  scopes?: string[];
  mutating?: boolean;
  risk?: RiskLevel;
  /** Mark superseded — kept callable; projections annotate the description (the id is a contract). */
  deprecated?: boolean;
  /** The replacement action id, surfaced in the projected description when `deprecated`. */
  replacedBy?: string;
  execute(ctx: ActionContext, input: z.output<S>): Promise<O>;
}

/** Custom-handler action — for anything `httpAction` can't express declaratively. */
export function action<S extends z.ZodTypeAny, O>(spec: ActionSpec<S, O>): Action<z.output<S>, O> {
  return {
    id: spec.id,
    description: spec.description,
    input: spec.input as unknown as z.ZodType<z.output<S>>,
    ...(spec.output ? { output: spec.output } : {}),
    ...(spec.scopes ? { scopes: spec.scopes } : {}),
    ...(spec.mutating !== undefined ? { mutating: spec.mutating } : {}),
    ...(spec.risk ? { risk: spec.risk } : {}),
    ...(spec.deprecated !== undefined ? { deprecated: spec.deprecated } : {}),
    ...(spec.replacedBy ? { replacedBy: spec.replacedBy } : {}),
    execute: spec.execute,
  };
}

/** The request descriptor an `httpAction` produces from its (validated) input. */
export type HttpActionRequest = Omit<HttpRequest, 'mutating' | 'signal'>;

export interface HttpActionSpec<S extends z.ZodTypeAny, O> {
  id: string;
  description: string;
  /** PURE domain input (Zod object). No `account` — the projection injects it (§6/§11). */
  input: S;
  scopes?: string[];
  mutating?: boolean;
  risk?: RiskLevel;
  /** Mark superseded — kept callable; projections annotate the description (the id is a contract). */
  deprecated?: boolean;
  /** The replacement action id, surfaced in the projected description when `deprecated`. */
  replacedBy?: string;
  /**
   * Build the request from validated input. The second arg exposes the connection's stored
   * `config` (per-connection metadata captured at connect — e.g. Jira `cloudId`, QuickBooks
   * `realmId`) so instance-scoped providers build their URL WITHOUT the agent passing a site id.
   */
  request: (input: z.output<S>, ctx: HttpActionContext) => HttpActionRequest;
  /** Map the raw response to the action's output. Omit to return the raw body. */
  output?: (raw: unknown) => O;
}

/** What an `httpAction`'s `request` can read about the connection (secret-free). */
export interface HttpActionContext {
  config: Record<string, unknown>;
}

/** Config-first REST action: `request` builds the call, `output` shapes the result. */
export function httpAction<S extends z.ZodTypeAny, O = unknown>(spec: HttpActionSpec<S, O>): Action<z.output<S>, O> {
  const mutating = spec.mutating ?? false;
  return {
    id: spec.id,
    description: spec.description,
    input: spec.input as unknown as z.ZodType<z.output<S>>,
    ...(spec.scopes ? { scopes: spec.scopes } : {}),
    mutating,
    ...(spec.risk ? { risk: spec.risk } : {}),
    ...(spec.deprecated !== undefined ? { deprecated: spec.deprecated } : {}),
    ...(spec.replacedBy ? { replacedBy: spec.replacedBy } : {}),
    async execute(ctx: ActionContext, input: z.output<S>): Promise<O> {
      const req = spec.request(input, { config: ctx.config });
      const raw = await ctx.http.request<unknown>({ ...req, mutating });
      return spec.output ? spec.output(raw) : (raw as O);
    },
  };
}
