/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Add booking: choose a file, paste a confirmation or enter details by hand.
 * A file or paste is previewed first, with parsed fields, source passages,
 * matching bookings and the trip it would join. Apply uses that preview once.
 */
import { useEffect, useState } from "react";
import { Button, ButtonRow, Checkbox, Dialog, InlineError, LoadingState, Notice, SegmentedControl, Select, StatusLabel, TextArea, useAnnounce, useMutation, useQuery, useRiApp } from "@ri/app-kit/ui";
import { useNav } from "./app.js";
import { BookingFields, draftFromForm, emptyForm, type FormState } from "./forms.js";
import type { ApplyResult, Booking, List, Preview, Trip, Write } from "./types.js";
import { errorText } from "./util.js";

const FILE_TYPES = ["application/pdf", "text/plain", "message/rfc822", "text/html"];
type Mode = "file" | "paste" | "manual";

export function AddBookingDialog({ open, tripId, onClose, onApplied }: { open: boolean; tripId: string | null; onClose(): void; onApplied(tripId: string | null): void }) {
  const app = useRiApp();
  const announce = useAnnounce();
  const { data } = useNav();
  const [mode, setMode] = useState<Mode>("paste");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<number, { include: boolean; trip: string }>>({});
  const [manual, setManual] = useState<FormState>(() => emptyForm("lodging"));
  const [manualTrip, setManualTrip] = useState<string>(tripId ?? "auto");
  const [handEntry, setHandEntry] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const previewMutation = useMutation<Record<string, unknown>, Preview>("preview_import");
  const apply = useMutation<Record<string, unknown>, ApplyResult>("apply_import");
  const save = useMutation<Record<string, unknown>, Write<Booking>>("save_booking");
  const trips = useQuery<List<Trip>>("list_trips", { limit: 100, when: "all" }, { enabled: open });
  useEffect(() => {
    if (!open) return;
    setMode("paste"); setText(""); setPreview(null); setChoices({}); setManual(emptyForm("lodging")); setManualTrip(tripId ?? "auto"); setHandEntry(false); setProblem(null);
    previewMutation.reset(); apply.reset(); save.reset();
  }, [open]);

  const tripOptions = [
    { value: "auto", label: "Choose automatically" },
    ...(trips.data?.items ?? []).filter((trip) => trip.projection === "full").map((trip) => ({ value: trip.id, label: `${trip.title}, ${trip.dateLabel}` })),
    { value: "none", label: "No trip yet, keep in Review" },
  ];
  const runPreview = async (input: Record<string, unknown>) => {
    setProblem(null);
    try {
      const result = await previewMutation.run(input);
      previewMutation.reset();
      setPreview(result);
      setChoices(Object.fromEntries(result.items.map((item) => [item.item, { include: true, trip: tripId ?? item.suggestedTripId ?? "auto" }])));
      setHandEntry(!result.items.length);
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  const chooseFile = async () => {
    setProblem(null);
    setReading(true);
    try {
      const file = await app.selectFile();
      if (!file) return;
      if (!FILE_TYPES.includes(file.mimeType)) { setProblem("Choose a PDF, text, HTML or saved email file. For another kind, paste the confirmation text."); return; }
      await runPreview({ kind: "file", fileName: file.name.slice(0, 200), mimeType: file.mimeType, base64: file.base64 });
    } catch (error) {
      setProblem(errorText(error, "The file could not be read"));
    } finally {
      setReading(false);
    }
  };
  const runApply = async () => {
    if (!preview) return;
    setProblem(null);
    let manualDraft = null;
    if (handEntry) {
      const check = draftFromForm(manual);
      if (check.problem) return setProblem(check.problem);
      manualDraft = check.draft;
    }
    try {
      const decisions = preview.items.map((item) => {
        const choice = choices[item.item] ?? { include: true, trip: "auto" };
        return { item: item.item, include: choice.include, ...(choice.trip === "auto" ? {} : { tripId: choice.trip === "none" ? null : choice.trip }) };
      });
      const result = await apply.run({ previewId: preview.previewId, digest: preview.digest, decisions, ...(manualDraft ? { manual: manualDraft, ...(manualTrip === "auto" ? {} : { manualTripId: manualTrip === "none" ? null : manualTrip }) } : {}) });
      if (result.status === "nothing_to_apply") { setHandEntry(true); setProblem(result.message); return; }
      announce(result.message);
      onApplied(result.openTripId);
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  const saveManual = async () => {
    const check = draftFromForm(manual);
    if (check.problem) return setProblem(check.problem);
    setProblem(null);
    try {
      const result = await save.run({ draft: check.draft, ...(manualTrip === "auto" ? {} : { tripId: manualTrip === "none" ? null : manualTrip }) });
      if (result.status === "saved") { announce(`${result.record.title} was added`); onApplied(result.record.tripId); }
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  const busy = previewMutation.pending || apply.pending || save.pending || reading;
  const footer = preview ? (
    <>
      <Button variant="quiet" onClick={() => setPreview(null)} disabled={busy}>Back</Button>
      <Button variant="primary" busy={apply.pending} busyLabel="Applying" onClick={() => void runApply()}>{handEntry && !preview.items.length ? "Save booking" : "Apply"}</Button>
    </>
  ) : mode === "manual" ? (
    <>
      <Button variant="quiet" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="primary" busy={save.pending} busyLabel="Saving" onClick={() => void saveManual()}>Save booking</Button>
    </>
  ) : mode === "paste" ? (
    <>
      <Button variant="quiet" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="primary" busy={previewMutation.pending} busyLabel="Reading" onClick={() => (text.trim() ? void runPreview({ kind: "paste", text }) : setProblem("Paste the confirmation text first"))}>Preview</Button>
    </>
  ) : (
    <Button variant="quiet" onClick={onClose} disabled={busy}>Cancel</Button>
  );

  return (
    <Dialog open={open} title={preview ? "Review before adding" : "Add booking"} wide onClose={onClose} busy={busy} footer={footer}
      description={preview ? "Nothing changes until you apply. Applying twice adds nothing more." : "Add a confirmation file, paste a confirmation, or enter a booking by hand."}>
      {!data.owner ? (
        <Notice tone="info">Only the owner can add bookings.</Notice>
      ) : preview ? (
        <PreviewBody preview={preview} choices={choices} setChoices={setChoices} tripOptions={tripOptions} handEntry={handEntry} setHandEntry={setHandEntry} manual={manual} setManual={setManual} manualTrip={manualTrip} setManualTrip={setManualTrip} />
      ) : (
        <>
          <SegmentedControl label="How to add" value={mode} onChange={(id) => { setMode(id as Mode); setProblem(null); }} options={[{ id: "paste", label: "Paste" }, { id: "file", label: "File" }, { id: "manual", label: "Enter details" }]} />
          {mode === "paste" && <TextArea label="Confirmation text" hint="Paste an email or booking page. It is read on this device and kept with the booking." value={text} onChange={setText} rows={10} maxLength={200000} />}
          {mode === "file" && (
            <div className="ri-stack">
              <p>Choose a PDF, text, HTML or saved email file up to 512 KB. Ri opens your file picker. Scans with no readable text ask for the details by hand, and the file is kept with the booking.</p>
              <ButtonRow><Button variant="primary" busy={reading || previewMutation.pending} busyLabel="Reading" onClick={() => void chooseFile()}>Choose file</Button></ButtonRow>
              {(reading || previewMutation.pending) && <LoadingState label="Reading the file" rows={1} />}
            </div>
          )}
          {mode === "manual" && (
            <>
              <BookingFields form={manual} onChange={setManual} />
              <Select label="Trip" value={manualTrip} onChange={setManualTrip} options={tripOptions} />
            </>
          )}
        </>
      )}
      <InlineError>{problem}</InlineError>
    </Dialog>
  );
}

function PreviewBody({ preview, choices, setChoices, tripOptions, handEntry, setHandEntry, manual, setManual, manualTrip, setManualTrip }: {
  preview: Preview; choices: Record<number, { include: boolean; trip: string }>; setChoices(value: Record<number, { include: boolean; trip: string }>): void;
  tripOptions: { value: string; label: string }[]; handEntry: boolean; setHandEntry(value: boolean): void; manual: FormState; setManual(value: FormState): void; manualTrip: string; setManualTrip(value: string): void;
}) {
  const set = (item: number, patch: Partial<{ include: boolean; trip: string }>) => setChoices({ ...choices, [item]: { ...(choices[item] ?? { include: true, trip: "auto" }), ...patch } });
  return (
    <div className="ri-stack">
      {preview.extraction === "ai" && <Notice tone="warning" title="Suggested by AI extraction.">Check every value against the quoted passages before applying.</Notice>}
      {preview.forwarded && <Notice tone="info">This was forwarded. New bookings from it wait in Review for you to choose the trip.</Notice>}
      {preview.notes.map((note) => <Notice key={note} tone="info">{note}</Notice>)}
      {preview.items.map((item) => (
        <article key={item.item} className="tr-preview-item" aria-label={item.summary}>
          <div className="tr-list-row">
            <strong>{item.summary}</strong>
            <span className="tr-inline">
              <StatusLabel tone="neutral">{item.kindLabel}</StatusLabel>
              {item.cancellation && <StatusLabel tone="danger">Cancellation</StatusLabel>}
              {item.change && <StatusLabel tone="warning">Change</StatusLabel>}
              {!item.complete && !item.cancellation && <StatusLabel tone="warning">Needs details</StatusLabel>}
            </span>
          </div>
          <p className="ri-small">{item.placement}</p>
          {item.match && item.match.changes.length > 0 && (
            <ul className="tr-history">
              {item.match.changes.map((change) => <li key={change.field}><span>{change.label}: {change.current} to {change.proposed}</span></li>)}
            </ul>
          )}
          {item.ambiguous.map((reason) => <p key={reason} className="ri-small tr-card__note">{reason}. It will wait in Review until you confirm it.</p>)}
          {!item.complete && !item.cancellation && item.missing.length > 0 && <p className="ri-small ri-muted">Not found in the source: {item.missing.map((field) => field.replace(/^segments\.\d+\./, "").replace(/^stay\./, "")).join(", ")}. It will wait in Review for you to fill in.</p>}
          {item.passages.length > 0 && (
            <details>
              <summary className="ri-small">Source passages</summary>
              <blockquote className="tr-quotes">{item.passages.map((passage) => <q key={passage}>{passage}</q>)}</blockquote>
            </details>
          )}
          <div className="ri-form-grid">
            <Checkbox label="Include" checked={choices[item.item]?.include ?? true} onChange={(include) => set(item.item, { include })} />
            {!item.match && !item.cancellation && <Select label="Trip" value={choices[item.item]?.trip ?? "auto"} onChange={(trip) => set(item.item, { trip })} options={tripOptions} />}
          </div>
        </article>
      ))}
      {!preview.items.length && (
        <Notice tone="warning" title="No booking details were found.">The original stays with whatever you enter. Enter the details by hand below, or go back and paste the text.</Notice>
      )}
      {(handEntry || !preview.items.length) ? (
        <div className="ri-stack">
          {preview.excerpt && (
            <details open={!preview.items.length}>
              <summary className="ri-small">Text read from {preview.fileName ?? "the source"}</summary>
              <pre className="tr-excerpt">{preview.excerpt}</pre>
            </details>
          )}
          <BookingFields form={manual} onChange={setManual} />
          <Select label="Trip" value={manualTrip} onChange={setManualTrip} options={tripOptions} />
          {preview.items.length > 0 && <Button variant="link" size="sm" onClick={() => setHandEntry(false)}>Do not add details by hand</Button>}
        </div>
      ) : (
        <Button variant="link" size="sm" onClick={() => setHandEntry(true)}>Also enter a booking by hand from this source</Button>
      )}
    </div>
  );
}
