/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Saved ideas stay visibly unbooked. Choose two to four to compare their
 * known prices, places, conditions and source dates. Unknown values say Not
 * provided, currencies are never converted or added, and nothing is ranked.
 */
import { useEffect, useState } from "react";
import { AskRiButton, Button, ButtonRow, Checkbox, DataTable, Dialog, EmptyState, ErrorState, InlineError, KeyValueList, LoadingState, MoneyInput, Notice, Select, TextArea, TextInput, Toolbar, useAnnounce, useMutation, useQuery, type MoneyValue } from "@ri/app-kit/ui";
import { formatDate } from "@ri/app-kit/time";
import { useNav } from "./app.js";
import type { Compare, Idea, List, Trip, Write } from "./types.js";
import { comparePrompt, errorText, ideaPrompt, plural, cleanError } from "./util.js";

const KINDS = [{ value: "place", label: "Place to visit" }, { value: "activity", label: "Activity" }, { value: "food", label: "Food and drink" }, { value: "stay", label: "Place to stay" }, { value: "transport", label: "Getting around" }];

export function IdeasTab({ trip, selected, onSelect }: { trip: Trip; selected: string | null; onSelect(id: string | null): void }) {
  const { data } = useNav();
  const ideas = useQuery<List<Idea>>("list_ideas", { tripId: trip.id, limit: 100 });
  const [chosen, setChosen] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [editing, setEditing] = useState<Idea | "new" | null>(null);
  const items = ideas.data?.items ?? [];
  useEffect(() => { setChosen((list) => list.filter((id) => items.some((idea) => idea.id === id))); }, [ideas.data]);
  const toggle = (id: string, on: boolean) => setChosen((list) => (on ? [...list.filter((item) => item !== id), id].slice(-4) : list.filter((item) => item !== id)));
  if (ideas.error && !ideas.data) return <ErrorState message={cleanError(ideas.error)} onRetry={() => void ideas.reload()} />;
  if (!ideas.data) return <LoadingState label="Loading ideas" />;
  const writable = data.owner && trip.projection === "full";
  return (
    <div className="ri-stack">
      <Notice tone="info" title="Ideas are not bookings.">They never count as confirmed. Prices are what you saved, with the date you saw them.</Notice>
      <Toolbar end={writable ? <Button onClick={() => setEditing("new")}>Save an idea</Button> : undefined}>
        <Button variant="primary" disabled={chosen.length < 2} onClick={() => setComparing(true)}>Compare {chosen.length >= 2 ? plural(chosen.length, "idea", "ideas") : "ideas"}</Button>
        <span className="ri-small ri-muted">{chosen.length < 2 ? "Choose two to four ideas to compare." : chosen.length === 4 ? "Four is the most to compare at once." : null}</span>
      </Toolbar>
      {items.length ? (
        <ul className="tr-ideas">
          {items.map((idea) => (
            <li key={idea.id} className="tr-idea" data-selected={selected === idea.id || undefined}>
              <span className="ri-eyebrow">Unbooked idea · {KINDS.find((kind) => kind.value === idea.kind)?.label}</span>
              <h3>{idea.title}</h3>
              {idea.note && <p className="ri-small">{idea.note}</p>}
              <KeyValueList items={[
                { label: "Known price", value: idea.priceLabel },
                { label: "Where", value: idea.location ?? "Not provided" },
                { label: "Conditions", value: idea.conditions ?? "Not provided" },
                { label: "Saved from", value: `${idea.sourceLabel ?? "Your idea"}${idea.observedAt ? `, ${formatDate(idea.observedAt.slice(0, 10), "short")}` : ""}` },
              ]} />
              <Checkbox label="Compare" checked={chosen.includes(idea.id)} onChange={(on) => toggle(idea.id, on)} />
              <ButtonRow>
                <AskRiButton size="sm" prompt={ideaPrompt(idea.title, trip.title)}>Discuss this idea</AskRiButton>
                {writable && <Button size="sm" variant="quiet" onClick={() => { onSelect(idea.id); setEditing(idea); }}>Edit</Button>}
              </ButtonRow>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact title="No ideas saved for this trip" action={writable ? <Button variant="primary" onClick={() => setEditing("new")}>Save an idea</Button> : undefined}>
          Keep places, activities and options here while you decide. They stay separate from bookings.
        </EmptyState>
      )}
      {comparing && <CompareDialog ids={chosen} tripTitle={trip.title} onClose={() => setComparing(false)} />}
      {editing && <IdeaDialog trip={trip} idea={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CompareDialog({ ids, tripTitle, onClose }: { ids: string[]; tripTitle: string; onClose(): void }) {
  const result = useQuery<Compare>("compare_ideas", { ids });
  const rows = result.data ? result.data.rows.map((row) => ({ id: row.label, label: row.label, ...Object.fromEntries(row.values.map((value, index) => [`v${index}`, value])) })) : [];
  return (
    <Dialog open title="Compare ideas" wide onClose={onClose} description="Known values only. Unknowns say Not provided. Nothing is ranked."
      footer={<ButtonRow>{result.data && <AskRiButton prompt={comparePrompt(result.data.ideas.map((idea) => idea.title), tripTitle)}>Ask Ri about these</AskRiButton>}<Button variant="primary" onClick={onClose}>Done</Button></ButtonRow>}>
      {result.error ? <ErrorState message={cleanError(result.error)} onRetry={() => void result.reload()} /> : !result.data ? <LoadingState label="Comparing" rows={2} /> : (
        <>
          <DataTable<Record<string, string>>
            caption="Idea comparison"
            captionHidden
            rowKey="id"
            rows={rows as Record<string, string>[]}
            cardBelow={420}
            columns={[{ key: "label", label: "Detail" }, ...result.data.ideas.map((idea, index) => ({ key: `v${index}`, label: idea.title }))]}
          />
          <p className="ri-small ri-muted">{result.data.note}</p>
        </>
      )}
    </Dialog>
  );
}

function IdeaDialog({ trip, idea, onClose }: { trip: Trip; idea: Idea | null; onClose(): void }) {
  const save = useMutation<Record<string, unknown>, Write<Idea>>("save_idea");
  const announce = useAnnounce();
  const [form, setForm] = useState(() => ({ kind: idea?.kind ?? "place", title: idea?.title ?? "", note: idea?.note ?? "", url: idea?.url ?? "", location: idea?.location ?? "", conditions: idea?.conditions ?? "" }));
  const [price, setPrice] = useState<MoneyValue>({ amountMinor: idea?.priceMinor ?? null, currency: idea?.currency ?? "EUR" });
  const [priceError, setPriceError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Idea | null>(null);
  const submit = async (remove = false) => {
    if (!remove && !form.title.trim()) return setProblem("Name the idea");
    if (form.url && !/^https:\/\/\S+$/i.test(form.url.trim())) return setProblem("Use a link that starts with https://");
    if (priceError) return setProblem(priceError);
    setProblem(null);
    const body = remove ? { removed: true } : {
      kind: form.kind, title: form.title.trim(), note: form.note.trim() || null, url: form.url.trim() || null, location: form.location.trim() || null, conditions: form.conditions.trim() || null,
      priceMinor: price.amountMinor, currency: price.amountMinor === null ? null : price.currency,
    };
    try {
      const result = await save.run(idea ? { id: idea.id, expectedRevision: conflict?.revision ?? idea.revision, ...body } : { tripId: trip.id, ...body });
      if (result.status === "conflict") { setConflict(result.current); setProblem("This idea changed since you opened it. Saving again keeps your version."); return; }
      announce(remove ? "Idea removed" : "Idea saved");
      onClose();
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  return (
    <Dialog open title={idea ? "Edit idea" : "Save an idea"} description="Ideas stay separate from bookings." onClose={onClose} busy={save.pending}
      footer={<>{idea && <Button variant="danger" onClick={() => void submit(true)} disabled={save.pending}>Remove idea</Button>}<Button variant="quiet" onClick={onClose} disabled={save.pending}>Cancel</Button><Button variant="primary" busy={save.pending} busyLabel="Saving" onClick={() => void submit()}>Save idea</Button></>}>
      <div className="ri-form-grid">
        <TextInput label="Idea" value={form.title} onChange={(title) => setForm({ ...form, title })} required maxLength={200} />
        <Select label="Kind" value={form.kind} onChange={(kind) => setForm({ ...form, kind: kind as Idea["kind"] })} options={KINDS} />
      </div>
      <TextArea label="Note" value={form.note} onChange={(note) => setForm({ ...form, note })} maxLength={2000} rows={3} />
      <MoneyInput label="Price you saw" hint="Optional. Kept in its own currency" value={price} onChange={(value, state) => { setPrice(value); setPriceError(state.error); }} currencies={["EUR", "USD", "GBP", "CAD", "MXN", "JPY", "AUD", "CHF"]} />
      <div className="ri-form-grid">
        <TextInput label="Where" value={form.location} onChange={(location) => setForm({ ...form, location })} maxLength={300} />
        <TextInput label="Check-in or conditions" value={form.conditions} onChange={(conditions) => setForm({ ...form, conditions })} maxLength={500} />
      </div>
      <TextInput label="Link" hint="Optional, https only. Opened outside Travel" value={form.url} onChange={(url) => setForm({ ...form, url })} inputMode="url" />
      <InlineError>{problem}</InlineError>
    </Dialog>
  );
}
