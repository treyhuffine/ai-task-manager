import {AppError} from '@ri/app-kit/contract';
import { z } from "zod/v4";
import * as q from "@/lib/db/queries";
import {
  financeAccountSchema,
  financeId,
  viewScopeSchema,
  scenarioChangesSchema,
  mutationKey,
  revisionNumber,
} from "@/lib/finance/contracts";
import { normalizeFinanceCsv } from "@/lib/finance/imports";
import { defaultFinanceViews } from "@/lib/finance/default-views";
import { createManagedScope, managedInstanceId,listManagedScopes,revokeManagedScope } from "./managed";
import {connectorCapabilities,ConnectorUnavailable} from '@/lib/connectors/client';
import {connectFinanceMailbox,disconnectFinanceSource} from '@/lib/finance/sources';
import type { FinancePrincipal } from "@/lib/db/finance-queries";
export const HOME_RESOURCE = "ui://ri-finance/home.html",
  VIEW_RESOURCE = "ui://personal-finance/renderer-v1.html";
export const contextState = z
  .object({
    selected: z
      .array(
        z
          .object({
            type: z.enum(["transaction", "evidence", "finding"]),
            id: financeId,
          })
          .strict(),
      )
      .max(50),
    viewRevision: revisionNumber.optional(),
    budgetRevision: revisionNumber.optional(),
    filters: z
      .object({
        startOn: z.string().optional(),
        endOn: z.string().optional(),
        accountIds: z.array(financeId).max(100).optional(),
      })
      .strict()
      .optional(),
    changes: scenarioChangesSchema.optional(),
  })
  .strict();
const location = z
  .object({
    path: z
      .string()
      .regex(/^\/(?!\/)/)
      .max(1024),
    query: z.record(z.string(), z.string()),
  })
  .strict();
function home(p: FinancePrincipal) {
  return {
    settings: p.owner ? q.getFinanceSettings() : null,
    accounts: q
      .listFinanceAccounts(p)
      .map(({ connectionId, ...account }) => { void connectionId; return account; }),
    budgets: q.listFinanceBudgets(p),
    views: q.listFinanceViews(p),
    owner: p.owner,
  };
}
function open(p: FinancePrincipal, input: z.infer<typeof location>) {
  if (input.path === '/access') {
    if (!p.owner) throw new AppError('forbidden','Only the human owner can choose account access');
    const actorId = input.query.hostActor;
    if (!/^(chat|workspace|job|background):[a-zA-Z0-9-]{1,128}$/.test(actorId ?? '')) throw new AppError('invalid_input','Choose a caller in the host before selecting accounts');
    const accounts = home(p).accounts;
    return {resource:HOME_RESOURCE,data:{settings:null,accounts,budgets:[],views:[],owner:true,accessSetup:{actorId}},scope:{actions:['finance_create_scope'],bindings:{actorId}}};
  }

  const recordMatch = /^\/records\/(transaction|evidence|finding)\/([a-zA-Z0-9-]+)$/.exec(input.path);
  if (recordMatch) {
    const type = recordMatch[1] as 'transaction'|'evidence'|'finding';
    const record = readRecord(p,type,recordMatch[2]);
    return {resource:HOME_RESOURCE,data:{...home(p),inspection:{type,record}},scope:{actions:[]}};
  }
  if (input.path === "/")
    return {
      resource: HOME_RESOURCE,
      data: home(p),
      scope: {
        actions: [
          ...localAppActions
            .filter(
              (action) =>
                action.audience.includes("user") &&
                (!action.ownerOnly || p.owner),
            )
            .map((action) => action.name),
          "finance_propose_budget",
          "finance_transactions",
          ...(p.owner ? ["finance_change_budget"] : []),
        ],
      },
    };
  const match = /^\/views\/([a-zA-Z0-9-]+)$/.exec(input.path);
  if (!match) throw new AppError("not_found","Finance view not found");
  const payload = q.openFinanceView(p, match[1]);
  return {
    resource: VIEW_RESOURCE,
    data: payload,
    scope: {
      actions: [
        "finance_refresh",
        "finance_filter",
        "finance_scenario_preview",
        "finance_inspect",
        "finance_save_view_filters",
        "finance_save_view_scenario",
        "finance_view_apply_scenario",
        "finance_view_undo_budget",
      ],
      bindings: { viewId: payload.view.id },
    },
  };
}
function readRecord(p:FinancePrincipal,type:'transaction'|'evidence'|'finding',id:string) {
  return type==='transaction'?q.getFinanceTransaction(p,id):type==='evidence'?q.getFinanceEvidence(p,id):q.getFinanceFinding(p,id);
}
type LocalDefinition = {
  name: string;
  description: string;
  input: z.ZodType;
  effect: "read" | "app_write" | "external_write";
  audience: ("user" | "agent" | "schedule")[];
  ownerOnly?: boolean;
  handler: (p: FinancePrincipal, input: never) => unknown;
};
export const localAppActions: LocalDefinition[] = [
  {name:'finance_source_connections',description:'Read available account bindings and fully supported connector operations',input:z.object({}).strict(),effect:'read',audience:['user'],ownerOnly:true,handler:async()=>{try{return {...await connectorCapabilities(),unavailable:false};}catch(error){if(error instanceof ConnectorUnavailable)return {version:1,principal:{id:managedInstanceId(),kind:'plugin'},connections:[],operations:[],unavailable:true};throw error;}}},
  {name:'finance_connect_mailbox',description:'Connect a permitted mailbox after explicit consent to broad mailbox reads',input:z.object({connectionId:financeId,provider:z.enum(['google','microsoft']),initialStartOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),query:z.string().max(500),monitoring:z.boolean(),acknowledgeBroadMailboxRead:z.literal(true)}).strict(),effect:'app_write',audience:['user'],ownerOnly:true,handler:connectFinanceMailbox},
  {name:'finance_disconnect_source',description:'Stop one Finance source and preserve or explicitly remove its cached records',input:z.object({id:financeId,retain:z.boolean()}).strict(),effect:'app_write',audience:['user'],ownerOnly:true,handler:(p,input:{id:string;retain:boolean})=>disconnectFinanceSource(p,input.id,input.retain)},
  {name:'finance_list_scopes',description:'List account scopes created for host actors',input:z.object({}).strict(),effect:'read',audience:['user'],ownerOnly:true,handler:listManagedScopes},
  {name:'finance_revoke_scope',description:'Revoke a host account scope and all its active service leases',input:z.object({scopeRef:z.string().uuid()}).strict(),effect:'app_write',audience:['user'],ownerOnly:true,handler:revokeManagedScope},
  {
    name: "finance_open_app",
    description:
      "Open Finance home or a saved view with current account permissions",
    input: location,
    effect: "read",
    audience: ["user", "agent"],
    handler: open,
  },
  {
    name: "finance_home",
    description: "Read permitted accounts, saved views and setup status",
    input: z.object({}).strict(),
    effect: "read",
    audience: ["user", "agent"],
    handler: home,
  },
  {
    name: "finance_setup",
    description: "Configure Finance before connecting or creating accounts",
    input: z
      .object({
        enabled: z.boolean(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        timezone: z.string().max(80),
        restoreReviewed: z.boolean(),
      })
      .strict(),
    effect: "app_write",
    audience: ["user"],
    ownerOnly: true,
    handler: (p, input) => q.configureFinance(p, input),
  },
  {
    name: "finance_create_account",
    description: "Create a manual account using exact minor units",
    input: financeAccountSchema,
    effect: "app_write",
    audience: ["user"],
    ownerOnly: true,
    handler: (p, input: z.infer<typeof financeAccountSchema>) => {
      if (input.provider !== "manual" || input.connectionId)
        throw new AppError("invalid_input","Use managed connector setup for connected accounts");
      return q.createFinanceAccount(p, input);
    },
  },
  {
    name: "finance_import_csv",
    description: "Import bounded CSV bytes into a selected manual account",
    input: z
      .object({
        accountId: financeId,
        text: z.string().max(800_000),
        positiveMeansSpending: z.boolean(),
      })
      .strict(),
    effect: "app_write",
    audience: ["user"],
    ownerOnly: true,
    handler: (
      p,
      input: {
        accountId: string;
        text: string;
        positiveMeansSpending: boolean;
      },
    ) => {
      const account = q.requireFinance(p, [input.accountId], "sync")[0];
      if (account.provider !== "manual")
        throw new AppError("invalid_input","Choose a manual account");
      const added = normalizeFinanceCsv({
        ...input,
        currency: account.currency,
      });
      q.applyFinanceSync(p, {
        accountIds: [account.id],
        generation: q.getFinanceSettings()!.generation,
        added,
        removed: [],
        asOf: new Date().toISOString(),
      });
      return { imported: added.length };
    },
  },
  {
    name: "finance_create_default_view",
    description: "Save one of the maintained declarative Finance views",
    input: z
      .object({
        name: z.enum([
          "Budget",
          "Needs attention",
          "Activity",
          "Subscriptions",
          "Accounts",
        ]),
        accountIds: z.array(financeId).min(1).max(100),
        startOn: z.string(),
        endOn: z.string(),
        budgetId: financeId.nullable(),
        mutationKey,
      })
      .strict(),
    effect: "app_write",
    audience: ["user", "agent"],
    handler: (
      p,
      input: {
        name: keyof typeof defaultFinanceViews;
        accountIds: string[];
        startOn: string;
        endOn: string;
        budgetId: string | null;
        mutationKey: string;
      },
    ) =>
      q.saveFinanceView(p, {
        definition: defaultFinanceViews[input.name],
        scope: viewScopeSchema.parse({
          accountIds: input.accountIds,
          startOn: input.startOn,
          endOn: input.endOn,
          budgetId: input.budgetId,
          evidenceId: null,
        }),
        expectedRevision: 0,
        mutationKey: input.mutationKey,
      }),
  },
  {
    name: "finance_create_scope",
    description:
      "Issue an opaque Finance account scope for one host actor. This is not a bearer credential",
    input: z
      .object({
        actorId: z.string().max(160),
        accountIds: z.array(financeId).min(1).max(100),
        operations: z
          .array(z.enum(["read", "write", "sync", "evidence"]))
          .min(1)
          .max(4),
      })
      .strict(),
    effect: "app_write",
    audience: ["user"],
    ownerOnly: true,
    handler: createManagedScope,
  },
  {
    name: "finance_describe_view_context",
    description:
      "Recompute authorized selected records, view filters and staged scenario proposals",
    input: location.extend({ state: contextState }),
    effect: "read",
    audience: ["user", "agent"],
    handler: (
      p,
      input: {
        path: string;
        query: Record<string, string>;
        state: z.infer<typeof contextState>;
      },
    ) => {
      const recordMatch = /^\/records\/(transaction|evidence|finding)\/([a-zA-Z0-9-]+)$/.exec(input.path);
      if (recordMatch) {
        const type=recordMatch[1] as 'transaction'|'evidence'|'finding',id=recordMatch[2];
        if (input.state.selected.length!==1 || input.state.selected[0].type!==type || input.state.selected[0].id!==id || input.state.filters || input.state.changes) throw new AppError('forbidden','This inspection can share only its opened record');
        const record=readRecord(p,type,id);
        const modelContent=JSON.stringify({type,record});
        if(Buffer.byteLength(modelContent)>16384)throw new AppError("invalid_input",'This record exceeds the shared context limit');
        return {modelContent,recordRefs:[{instanceId:managedInstanceId(),entityType:type,recordId:id}],dataRevision:record.updatedAt};
      }
      if (input.path === "/") {
        if (input.state.selected.length)
          throw new AppError("invalid_input","Open a saved view to select records");
        return {
          modelContent: JSON.stringify({
            availableViews: q
              .listFinanceViews(p)
              .map((view) => ({
                id: view.id,
                title: view.definition.title,
                revision: view.revision,
              })),
            accountCount: q.listFinanceAccounts(p).length,
          }),
          recordRefs: [],
          dataRevision: String(q.getFinanceSettings()?.generation ?? 0),
        };
      }
      const id = input.path.split("/")[2],
        view = q.getFinanceView(p, id);
      if (input.state.viewRevision !== view.revision)
        throw new AppError("conflict","The view revision changed");
      if (
        view.scope.budgetId &&
        input.state.budgetRevision !==
          q.getFinanceBudget(p, view.scope.budgetId).revision
      )
        throw new AppError("conflict","The budget revision changed");
      const payload = q.openFinanceView(p, id, {
        filters: input.state.filters,
        changes: input.state.changes,
      });
      const records = input.state.selected.map((ref) => {
        const rows =
          ref.type === "transaction"
            ? payload.data.transactions
            : ref.type === "evidence"
              ? payload.data.evidence
              : payload.data.findings;
        const record = rows.find((row) => row.id === ref.id);
        if (!record)
          throw new AppError("invalid_input",
            "A selected record is outside this view or permission",
          );
        return { type: ref.type, record };
      });
      const modelContent = JSON.stringify({
        view: { id, revision: view.revision, title: view.definition.title },
        budgetRevision: payload.data.budgetRecord?.revision,
        figures: payload.data.budget,
        selection: records,
        proposedChanges: input.state.changes ?? null,
      });
      if (Buffer.byteLength(modelContent) > 16_384)
        throw new AppError("invalid_input","Reduce the selection before sharing context");
      return {
        modelContent,
        recordRefs: records.map((item) => ({
          instanceId: managedInstanceId(),
          entityType: item.type,
          recordId: item.record.id,
        })),
        dataRevision: `${view.revision}:${payload.data.budgetRecord?.revision ?? 0}`,
      };
    },
  },
];
