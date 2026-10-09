"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcClient } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {AppView} from './app-view';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import { KEY, useLocalApps } from "./app-hooks";
type Kind = "owner-ui" | "chat" | "workspace" | "job" | "background";
export function AppGrantEditor({
  instanceId,
  chatId,
  principal,
  onSaved,
}: {
  instanceId: string;
  chatId?: string;
  principal?: {kind: Kind; id: string};
  onSaved?: () => void;
}) {
  const { data } = useLocalApps(),
    qc = useQueryClient();
  const description = useQuery({
    queryKey: [...KEY, "describe", instanceId],
    queryFn: () => trpcClient.localApps.describe.query({ id: instanceId }),
  });
  const accounts = useQuery({
    queryKey: ["app-connector-accounts"],
    queryFn: () => trpcClient.integrations.connectionsGet.query({}),
  });
  const [kind, setKind] = useState<Kind>(principal?.kind ?? (chatId ? "chat" : "owner-ui")),
    [actor, setActor] = useState(principal?.id ?? chatId ?? "owner"),
    [actions, setActions] = useState<string[]>([]),
    [riActions, setRiActions] = useState<string[]>([]),
    [bindings, setBindings] = useState<
      Record<string, { connectionId: string; actions: string[] }>
    >({}),
    [scope, setScope] = useState(""),
    [busy, setBusy] = useState(false),
    [choosingScope,setChoosingScope] = useState(false);
  const requests = description.data?.manifest.extensions["com.ri"].requests;
  const existing = data?.grants.findLast(grant => grant.instanceId === instanceId && grant.principal.kind === kind && grant.principal.id === actor);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const grant = existing?.revokedAt ? undefined : existing;
      setActions(grant?.actions ?? []);
      setRiActions(grant?.riActions ?? []);
      setBindings(Object.fromEntries((grant?.connections ?? []).map(({binding,...value}) => [binding,value])));
      setScope(grant?.serviceScopeRef ?? '');
    });
    return () => {cancelled = true;};
  // The registry polls. Only a changed caller or grant version resets this edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, kind, actor, existing?.id, existing?.revision]);
  const toggle = (values: string[], value: string, checked: boolean) =>
    checked ? [...values, value] : values.filter((item) => item !== value);
  async function save() {
    if (!data) return;
    setBusy(true);
    try {
      await trpcClient.localApps.grant.mutate({
        revision: data.revision,
        grant: {
          instanceId,
          principal: { kind, id: actor },
          actions,
          riActions,
          connections: Object.entries(bindings)
            .filter(
              ([, binding]) => binding.connectionId && binding.actions.length,
            )
            .map(([binding, value]) => ({ binding, ...value })),
          serviceScopeRef: scope.trim() || null,
        },
      });
      await qc.invalidateQueries({ queryKey: KEY });
      onSaved?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Access could not be saved",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded border p-4">
      <h3 className="font-medium">Allow selected access</h3>
      <p className="text-sm text-muted-foreground">
        This permission belongs to one caller. App callbacks and connector
        access use that caller’s grant.
      </p>
      <div className="flex gap-2">
        <select
          aria-label="Caller kind"
          value={kind}
          disabled={!!chatId || !!principal}
          onChange={(event) => {
            const next = event.target.value as Kind;
            setKind(next);
            setActor(
              next === "owner-ui"
                ? "owner"
                : next === "background"
                  ? instanceId
                  : "",
            );
          }}
          className="rounded border bg-background p-2"
        >
          {(
            ["owner-ui", "chat", "workspace", "job", "background"] as const
          ).map((value) => (
            <option key={value} value={value}>
              {value === "owner-ui"
                ? "Human app view"
                : value === "workspace"
                  ? "Agent"
                  : value}
            </option>
          ))}
        </select>
        {(chatId || principal || kind === 'owner-ui') ? <p className="flex items-center text-sm">{chatId ? 'This chat' : kind === 'owner-ui' ? 'You' : 'This scheduled action'}</p> : <input
          aria-label="Caller ID"
          value={actor}
          onChange={(event) => setActor(event.target.value)}
          className="min-w-0 flex-1 rounded border bg-background p-2"
        />}
      </div>
      {kind !== 'owner-ui' && <Button variant="outline" size="sm" onClick={()=>setActions(description.data?.contract.actions.filter(action=>action.effect==='read'&&action.audience.includes(kind==='job'||kind==='background'?'schedule':'agent')&&action.visibility!=='app').map(action=>action.name)??[])}>Allow read actions</Button>}
      <div className="max-h-60 overflow-auto">
        {description.data?.contract.actions
          .filter((action) =>
            action.audience.includes(
              kind === "owner-ui"
                ? "user"
                : kind === "job" || kind === "background"
                  ? "schedule"
                  : "agent",
            ),
          )
          .map((action) => (
            <label key={action.name} className="block py-1 text-sm">
              <input
                type="checkbox"
                checked={actions.includes(action.name)}
                onChange={(event) =>
                  setActions(toggle(actions, action.name, event.target.checked))
                }
              />{" "}
              {action.name}{" "}
              <span className="text-muted-foreground">{action.effect}</span>
            </label>
          ))}
      </div>
      {description.data?.manifest.extensions["com.ri"].runtime.protocol ===
        "mcp-http-v1" &&
        kind !== "owner-ui" && (
          <div className="space-y-2 text-sm">
            {description.data.manifest.extensions['com.ri'].ui?.access ? <>
              <p>{scope ? 'Selected account access is ready to bind to this caller.' : 'Choose which app records this caller may use.'}</p>
              <Button variant="outline" disabled={!actor} onClick={()=>setChoosingScope(true)}>{scope ? 'Change account access' : 'Choose account access'}</Button>
              <Dialog open={choosingScope} onOpenChange={setChoosingScope}><DialogContent className="flex h-[80vh] max-w-3xl flex-col"><DialogHeader><DialogTitle>Choose account access</DialogTitle></DialogHeader><div className="relative min-h-0 flex-1"><AppView id={instanceId} path={description.data.manifest.extensions['com.ri'].ui?.access.path} query={{hostActor:`${kind}:${actor}`}} digest={description.data.instance.digest} authorityRevision={data?.grants.find(grant=>grant.instanceId===instanceId&&grant.principal.kind==='owner-ui')?.revision??0} onNavigate={()=>{}} onAccessCreated={value=>{setScope(value);setChoosingScope(false);}} /></div></DialogContent></Dialog>
            </> : <label className="block">App account scope<input aria-label="App account scope" value={scope} onChange={event=>setScope(event.target.value)} className="mt-1 w-full rounded border bg-background p-2" /><span className="text-xs text-muted-foreground">Create this scope in the app for the selected caller.</span></label>}
          </div>
        )}
      {!!requests?.riActions.length && (
        <fieldset>
          <legend className="text-sm font-medium">Ri actions</legend>
          {requests.riActions.map((name) => (
            <label key={name} className="block text-sm">
              <input
                type="checkbox"
                checked={riActions.includes(name)}
                onChange={(event) =>
                  setRiActions(toggle(riActions, name, event.target.checked))
                }
              />{" "}
              {name}
            </label>
          ))}
        </fieldset>
      )}
      {requests?.integrations.map((request) => (
        <fieldset
          key={request.binding}
          className="space-y-2 rounded border p-3"
        >
          <legend className="text-sm font-medium">
            {request.toolkit}: {request.binding}
          </legend>
          <select
            aria-label={`Account for ${request.binding}`}
            value={bindings[request.binding]?.connectionId ?? ""}
            onChange={(event) =>
              setBindings({
                ...bindings,
                [request.binding]: {
                  connectionId: event.target.value,
                  actions: bindings[request.binding]?.actions ?? [],
                },
              })
            }
            className="w-full rounded border bg-background p-2"
          >
            <option value="">No account access</option>
            {accounts.data?.connections
              .filter((account) => account.status === "active")
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label ?? account.email ?? account.providerId}
                </option>
              ))}
          </select>
          {request.actions.map((name) => (
            <label key={name} className="block text-sm">
              <input
                type="checkbox"
                checked={
                  bindings[request.binding]?.actions.includes(name) ?? false
                }
                onChange={(event) =>
                  setBindings({
                    ...bindings,
                    [request.binding]: {
                      connectionId:
                        bindings[request.binding]?.connectionId ?? "",
                      actions: toggle(
                        bindings[request.binding]?.actions ?? [],
                        name,
                        event.target.checked,
                      ),
                    },
                  })
                }
              />{" "}
              {name}
            </label>
          ))}
        </fieldset>
      ))}
      <Button
        disabled={
          busy ||
          !actor ||
          (!actions.length &&
            !Object.values(bindings).some((binding) => binding.actions.length))
        }
        onClick={() => void save()}
      >
        Allow selected access
      </Button>
    </section>
  );
}
