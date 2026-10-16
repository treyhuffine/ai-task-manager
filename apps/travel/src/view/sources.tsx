/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Sources: the shared SourcesScreen for accounts, imports and chat access,
 * plus Travel's settings (home zone, your names, the AI fallback switch) and
 * which calendars to check for conflicts.
 */
import { useEffect, useState } from "react";
import { AppShell, Button, ButtonRow, Checkbox, ErrorState, InlineError, LoadingState, Notice, SectionPanel, SourcesScreen, TextInput, useAnnounce, useMutation, useQuery, useRiApp, type HistoryDays, type SourceAccount } from "@ri/app-kit/ui";
import { MainTabs, useNav } from "./app.js";
import type { Sources, StepResult } from "./types.js";
import { cleanError, cleanly, errorText } from "./util.js";
import { validZone } from "./trip.js";

export function SourcesScreenView() {
  const app = useRiApp();
  const { navigate, data } = useNav();
  const sources = useQuery<Sources>("list_sources", {}, { enabled: data.owner });
  const pause = useMutation<Record<string, unknown>, unknown>("pause_source");
  const proceed = useMutation<Record<string, unknown>, StepResult>("continue_import");
  const remove = useMutation<Record<string, unknown>, unknown>("delete_source_data");
  const setup = useMutation<Record<string, unknown>, unknown>("setup_source");
  const revoke = useMutation<Record<string, unknown>, unknown>("revoke_scope");
  const [step, setStep] = useState<string | null>(null);
  const list = sources.data;
  const byId = new Map((list?.accounts ?? []).map((account) => [account.id, account]));
  const accounts: SourceAccount[] = (list?.accounts ?? []).map((account) => ({
    id: account.id, label: account.label, detail: account.fictional ? "Fictional example" : account.kind === "calendar" && account.calendars.length ? `${account.calendars.length} calendar${account.calendars.length === 1 ? "" : "s"} checked` : undefined,
    // A fictional preview account is example data, not an account connected to Ri.
    kind: account.kind, granted: account.granted || account.fictional, automatic: account.automatic && !account.paused, status: account.status,
    ...(account.coverage ? { coverage: account.coverage } : {}), historyDays: account.historyDays as HistoryDays, lastSuccessAt: account.lastSuccessAt, pending: account.pending, failed: account.failed, error: account.error,
  }));
  return (
    <AppShell eyebrow="Travel" title="Sources" context="Where trips come from, and who can use them." tabs={<MainTabs value="sources" />}>
      <SectionPanel panelId="travel-main" value="sources">
        {!data.owner ? <Notice tone="info">Only the owner manages sources.</Notice> : sources.error && !list ? <ErrorState message={cleanError(sources.error)} onRetry={() => void sources.reload()} /> : !list ? <LoadingState label="Loading sources" /> : (
          <div className="ri-stack ri-stack--loose">
            {list.accounts.filter((account) => account.firstDetected && !account.automatic).map((account) => (
              <Notice key={account.id} tone="info" title={`Found in ${account.label}: ${account.firstDetected!.title}, ${account.firstDetected!.dateLabel}.`}
                action={<Button size="sm" onClick={() => navigate({ section: "trip", tripId: account.firstDetected!.tripId, tab: "itinerary", day: null, selected: null, status: "all", q: "" })}>Open trip</Button>}>
                {account.firstDetected!.bookings} booking{account.firstDetected!.bookings === 1 ? "" : "s"} so far. Check it before turning on automatic updates.
              </Notice>
            ))}
            {step && <Notice tone="info" live>{step}</Notice>}
            <SourcesScreen
              accounts={accounts}
              imports={list.imports}
              shares={list.shares.filter((share) => !share.revoked).map((share) => ({ id: share.id, label: share.label, actor: share.actor.startsWith("chat:") ? "A chat" : share.actor, sources: share.sources.map((key) => labelFor(key, list)), createdAt: share.createdAt }))}
              note={<div className="ri-stack ri-stack--tight"><p>{list.note}</p><details><summary>What Travel searches for in Gmail</summary><p className="ri-small ri-muted" style={{ marginTop: "0.5rem", overflowWrap: "anywhere" }}>{list.mailQuery}</p></details></div>}
              onConnect={() => app.openSources()}
              onManageAccess={() => app.manageAccess()}
              onPause={(id) => cleanly(() => pause.run({ account: byId.get(id)!.account, paused: true }))}
              onResume={(id) => cleanly(() => (byId.get(id)?.paused ? pause.run({ account: byId.get(id)!.account, paused: false }) : app.openSources()))}
              onContinue={(id) => cleanly(async () => {
                const account = byId.get(id)!;
                const result = await proceed.run({ source: `account:${account.account}`, kind: account.kind });
                setStep(result.step.summary);
              })}
              onDeleteImported={(id) => cleanly(() => remove.run({ source: id.startsWith("import:") ? id : `account:${byId.get(id)?.account ?? id}` }))}
              onChangeHistory={(id, days) => cleanly(() => setup.run({ account: byId.get(id)!.account, kind: byId.get(id)!.kind, historyDays: days }))}
              onRevokeShare={(id) => cleanly(() => revoke.run({ scopeRef: id }))}
            />
            {list.accounts.filter((account) => account.kind === "calendar" && account.granted).map((account) => <CalendarChooser key={account.id} account={account.account} label={account.label} chosen={account.calendars} />)}
            <Settings settings={list.settings} />
          </div>
        )}
      </SectionPanel>
    </AppShell>
  );
}

function labelFor(key: string, list: Sources) {
  if (key === "manual") return "Manual entries";
  if (key === "imports") return "Imported files";
  const account = list.accounts.find((item) => `account:${item.account}` === key);
  return account?.label ?? "An account";
}

function CalendarChooser({ account, label, chosen }: { account: string; label: string; chosen: string[] }) {
  const calendars = useQuery<{ calendars: { id: string; summary: string; primary: boolean }[]; chosen: string[] }>("list_calendars", { account });
  const setup = useMutation<Record<string, unknown>, unknown>("setup_source");
  const announce = useAnnounce();
  const [selected, setSelected] = useState(chosen);
  useEffect(() => { setSelected(chosen); }, [chosen.join("|")]);
  return (
    <section className="ri-card tr-settings" aria-label={`Calendars in ${label}`}>
      <h2 className="ri-h3">Calendars to check in {label}</h2>
      <p className="ri-small ri-muted">Travel reads these only to show events while you are away. It never changes your calendar.</p>
      {calendars.error ? <ErrorState message={cleanError(calendars.error)} onRetry={() => void calendars.reload()} /> : !calendars.data ? <LoadingState label="Loading calendars" rows={1} /> : (
        <>
          {calendars.data.calendars.map((calendar) => (
            <Checkbox key={calendar.id} label={`${calendar.summary}${calendar.primary ? " (main calendar)" : ""}`} checked={selected.includes(calendar.id) || (calendar.primary && selected.includes("primary"))}
              onChange={(on) => setSelected((list) => (on ? [...list.filter((id) => id !== calendar.id), calendar.id] : list.filter((id) => id !== calendar.id && !(calendar.primary && id === "primary"))))} />
          ))}
          <ButtonRow><Button busy={setup.pending} onClick={async () => { try { await setup.run({ account, kind: "calendar", calendars: selected.slice(0, 20) }); announce("Calendars saved"); } catch { /* shown below */ } }}>Save calendars</Button></ButtonRow>
          <InlineError>{cleanError(setup.error)}</InlineError>
        </>
      )}
    </section>
  );
}

function Settings({ settings }: { settings: Sources["settings"] }) {
  const save = useMutation<Record<string, unknown>, unknown>("save_settings");
  const announce = useAnnounce();
  const [zone, setZone] = useState(settings.homeZone ?? "");
  const [names, setNames] = useState(settings.ownerNames.join(", "));
  const [ai, setAi] = useState(settings.aiExtraction);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    if (zone.trim() && !validZone(zone.trim())) return setProblem("Use a time zone such as America/Denver");
    setProblem(null);
    try {
      await save.run({ homeZone: zone.trim() || null, ownerNames: names.split(",").map((name) => name.trim()).filter(Boolean).slice(0, 10), aiExtraction: ai });
      announce("Settings saved");
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  return (
    <section className="ri-card tr-settings" aria-labelledby="tr-settings-title">
      <h2 className="ri-h3" id="tr-settings-title">Travel settings</h2>
      <div className="ri-form-grid">
        <TextInput label="Home time zone" hint="For today, trip dates and your calendar, such as America/Denver" value={zone} onChange={setZone} />
        <TextInput label="Your name on bookings" hint="Bookings for someone else wait in Review. Separate names with commas" value={names} onChange={setNames} />
      </div>
      <Checkbox
        label="Read hard confirmations with AI"
        hint="Off by default. When the built-in readers find nothing, Ri's qualified AI may read the text, quoting exact passages. Suggestions always wait in Review. When AI is unavailable, Travel says Extraction unavailable and everything else keeps working."
        checked={ai}
        onChange={setAi}
      />
      <ButtonRow><Button variant="primary" busy={save.pending} busyLabel="Saving" onClick={() => void submit()}>Save settings</Button></ButtonRow>
      <InlineError>{problem}</InlineError>
    </section>
  );
}
