/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * The booking form used for manual entry, for confirming extracted details
 * and for corrections. Times are local wall times. A zone is taken from the
 * airport code when one is given, otherwise typed as an IANA zone.
 */
import { useEffect, useState } from "react";
import { Button, ConflictNotice, DateInput, Dialog, InlineError, Select, TextInput, useAnnounce, useMutation } from "@ri/app-kit/ui";
import type { Booking, BookingDraft, Write } from "./types.js";
import { errorText, KIND_LABELS, cleanError } from "./util.js";
import { validZone } from "./trip.js";

export interface Leg {
  number: string; fromLabel: string; fromCode: string; toLabel: string; toCode: string;
  startDate: string | null; startTime: string; startZone: string; endDate: string | null; endTime: string; endZone: string; address: string; endAddress: string;
}
export interface FormState {
  kind: Booking["kind"]; title: string; provider: string; reference: string; travelers: string; status: "planned" | "confirmed" | "canceled"; detail: string;
  propertyName: string; stayAddress: string; checkInDate: string | null; checkInTime: string; checkOutDate: string | null; checkOutTime: string; stayZone: string;
  legs: Leg[];
}
const emptyLeg = (): Leg => ({ number: "", fromLabel: "", fromCode: "", toLabel: "", toCode: "", startDate: null, startTime: "", startZone: "", endDate: null, endTime: "", endZone: "", address: "", endAddress: "" });
export function emptyForm(kind: Booking["kind"] = "flight"): FormState {
  return { kind, title: "", provider: "", reference: "", travelers: "", status: "confirmed", detail: "", propertyName: "", stayAddress: "", checkInDate: null, checkInTime: "", checkOutDate: null, checkOutTime: "", stayZone: "", legs: [emptyLeg()] };
}
const split = (local: string | null | undefined) => (local ? { date: local.slice(0, 10), time: local.length > 10 ? local.slice(11, 16) : "" } : { date: null, time: "" });

export function formFromDraft(draft: BookingDraft | null, prefill: Record<string, string | null> = {}): FormState {
  const form = emptyForm(draft?.kind ?? "flight");
  if (!draft) return form;
  const pre = (path: string) => prefill[path] ?? null;
  Object.assign(form, {
    title: draft.title ?? "", provider: draft.provider ?? "", reference: draft.reference ?? "", travelers: (draft.travelers ?? []).join(", "),
    status: draft.status === "planned" ? "planned" : draft.status === "canceled" ? "canceled" : "confirmed", detail: draft.detail ?? "",
    propertyName: draft.stay?.propertyName ?? pre("stay.propertyName") ?? "", stayAddress: draft.stay?.address ?? pre("stay.address") ?? "",
    checkInDate: draft.stay?.checkInDate ?? pre("stay.checkInDate"), checkInTime: draft.stay?.checkInTime ?? pre("stay.checkInTime") ?? "",
    checkOutDate: draft.stay?.checkOutDate ?? pre("stay.checkOutDate"), checkOutTime: draft.stay?.checkOutTime ?? pre("stay.checkOutTime") ?? "", stayZone: draft.stay?.zone ?? pre("stay.zone") ?? "",
  });
  const segments = draft.segments?.length ? draft.segments : [];
  const count = Math.max(segments.length, ...Object.keys(prefill).map((key) => (/^segments\.(\d+)\./.exec(key) ? Number(/^segments\.(\d+)\./.exec(key)![1]) + 1 : 0)), 1);
  form.legs = Array.from({ length: count }, (_, index) => {
    const segment = segments[index];
    const p = (key: string) => pre(`segments.${index}.${key}`);
    const start = split(segment?.startLocal ?? p("startLocal")), end = split(segment?.endLocal ?? p("endLocal"));
    return {
      number: segment?.number ?? p("number") ?? "", fromLabel: segment?.originLabel ?? p("originLabel") ?? "", fromCode: segment?.originCode ?? p("originCode") ?? "",
      toLabel: segment?.destinationLabel ?? p("destinationLabel") ?? "", toCode: segment?.destinationCode ?? p("destinationCode") ?? "",
      startDate: start.date, startTime: start.time, startZone: segment?.startZone ?? p("startZone") ?? "", endDate: end.date, endTime: end.time, endZone: segment?.endZone ?? p("endZone") ?? "",
      address: segment?.address ?? p("address") ?? "", endAddress: segment?.endAddress ?? p("endAddress") ?? "",
    };
  });
  return form;
}
export function formFromBooking(booking: Booking): FormState {
  return formFromDraft({
    kind: booking.kind, title: booking.title, provider: booking.provider, reference: booking.reference, travelers: booking.travelers, status: booking.status, detail: booking.detail,
    stay: booking.stay ? { propertyName: booking.stay.propertyName, address: booking.stay.address, checkInDate: booking.stay.checkInDate, checkOutDate: booking.stay.checkOutDate, checkInTime: booking.stay.checkInTime, checkOutTime: booking.stay.checkOutTime, zone: booking.stay.zone } : null,
    segments: booking.segments.map((segment) => ({ number: segment.number, originLabel: segment.origin.label, originCode: segment.origin.code, destinationLabel: segment.destination.label, destinationCode: segment.destination.code, startLocal: segment.start.local, startZone: segment.start.zone, endLocal: segment.end?.local ?? null, endZone: segment.end?.zone ?? null, address: segment.address, endAddress: segment.endAddress })),
  });
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const blank = (value: string) => (value.trim() ? value.trim() : null);
const local = (date: string | null, time: string) => (date ? (time.trim() ? `${date}T${time.trim()}` : date) : null);

/** The draft a form describes, or the first problem to fix. */
export function draftFromForm(form: FormState): { draft: BookingDraft | null; problem: string | null } {
  const travelers = form.travelers.split(",").map((name) => name.trim()).filter(Boolean);
  for (const time of [form.checkInTime, form.checkOutTime, ...form.legs.flatMap((leg) => [leg.startTime, leg.endTime])]) if (time.trim() && !TIME.test(time.trim())) return { draft: null, problem: "Write times on a 24-hour clock, such as 08:40" };
  for (const zone of [form.stayZone, ...form.legs.flatMap((leg) => [leg.startZone, leg.endZone])]) if (zone.trim() && !validZone(zone.trim())) return { draft: null, problem: `${zone} is not a time zone. Use one such as Europe/Lisbon` };
  const base = { kind: form.kind, title: blank(form.title), provider: blank(form.provider), reference: blank(form.reference), travelers, status: form.status, detail: blank(form.detail) };
  if (form.kind === "lodging") {
    if (!form.propertyName.trim()) return { draft: null, problem: "Add the property name" };
    if (!form.checkInDate || !form.checkOutDate) return { draft: null, problem: "Add the check-in and check-out dates" };
    if (form.checkOutDate <= form.checkInDate) return { draft: null, problem: "Check-out must be after check-in" };
    return { draft: { ...base, title: base.title ?? form.propertyName.trim(), stay: { propertyName: form.propertyName.trim(), address: blank(form.stayAddress), checkInDate: form.checkInDate, checkOutDate: form.checkOutDate, checkInTime: blank(form.checkInTime), checkOutTime: blank(form.checkOutTime), zone: blank(form.stayZone) }, segments: [] }, problem: null };
  }
  const segments = [];
  for (const leg of form.legs) {
    if (!leg.startDate) return { draft: null, problem: form.kind === "car" ? "Add the pick-up date" : form.kind === "activity" ? "Add the date" : "Add the departure date" };
    if (leg.endDate && leg.endDate < leg.startDate) return { draft: null, problem: "The end date is before the start date" };
    segments.push({
      number: blank(leg.number), originLabel: blank(leg.fromLabel), originCode: blank(leg.fromCode)?.toUpperCase() ?? null, destinationLabel: blank(leg.toLabel), destinationCode: blank(leg.toCode)?.toUpperCase() ?? null,
      startLocal: local(leg.startDate, leg.startTime)!, startZone: blank(leg.startZone), endLocal: local(leg.endDate ?? (leg.endTime.trim() ? leg.startDate : null), leg.endTime), endZone: blank(leg.endZone),
      address: blank(leg.address), endAddress: blank(leg.endAddress),
    });
  }
  const title = base.title ?? (form.kind === "flight" && segments[0]?.number ? `Flight ${segments[0].number}` : form.kind === "train" && segments[0]?.number ? `Train ${segments[0].number}` : null);
  if (!title && form.kind === "activity") return { draft: null, problem: "Name the activity or reservation" };
  return { draft: { ...base, title, segments, stay: null }, problem: null };
}

/** Kind-specific fields. `fixedKind` hides the kind choice when correcting. */
export function BookingFields({ form, onChange, fixedKind }: { form: FormState; onChange(form: FormState): void; fixedKind?: boolean }) {
  const set = (patch: Partial<FormState>) => onChange({ ...form, ...patch });
  const setLeg = (index: number, patch: Partial<Leg>) => onChange({ ...form, legs: form.legs.map((leg, position) => (position === index ? { ...leg, ...patch } : leg)) });
  const journey = form.kind === "flight" || form.kind === "train";
  return (
    <div className="tr-form">
      <div className="ri-form-grid">
        {!fixedKind && <Select label="Kind" value={form.kind} onChange={(kind) => set({ kind: kind as FormState["kind"] })} options={(Object.keys(KIND_LABELS) as FormState["kind"][]).map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))} />}
        <TextInput label={form.kind === "lodging" ? "Title" : "Title"} hint={journey ? "Optional. Defaults to the number" : "Optional"} value={form.title} onChange={(title) => set({ title })} maxLength={200} />
        <TextInput label="Provider" hint="Airline, hotel, operator or company" value={form.provider} onChange={(provider) => set({ provider })} maxLength={200} />
        <TextInput label="Confirmation" hint="Booking reference" value={form.reference} onChange={(reference) => set({ reference })} maxLength={60} />
        <TextInput label="Travelers" hint="Separate names with commas" value={form.travelers} onChange={(travelers) => set({ travelers })} />
        <Select label="Status" value={form.status} onChange={(status) => set({ status: status as FormState["status"] })} options={[{ value: "confirmed", label: "Confirmed" }, { value: "planned", label: "Planned, not yet confirmed" }, ...(fixedKind ? [{ value: "canceled", label: "Canceled" }] : [])]} />
      </div>
      {form.kind === "lodging" ? (
        <fieldset>
          <legend>Stay</legend>
          <div className="ri-form-grid">
            <TextInput label="Property" value={form.propertyName} onChange={(propertyName) => set({ propertyName })} required maxLength={200} />
            <TextInput label="Address" value={form.stayAddress} onChange={(stayAddress) => set({ stayAddress })} maxLength={400} />
            <DateInput label="Check-in date" value={form.checkInDate} onChange={(checkInDate) => set({ checkInDate })} required />
            <TextInput label="Check-in time" hint="Optional, 24-hour" value={form.checkInTime} onChange={(checkInTime) => set({ checkInTime })} inputMode="numeric" placeholder="15:00" />
            <DateInput label="Check-out date" hint="The morning you leave. Not counted as a night" value={form.checkOutDate} onChange={(checkOutDate) => set({ checkOutDate })} required />
            <TextInput label="Check-out time" hint="Optional, 24-hour" value={form.checkOutTime} onChange={(checkOutTime) => set({ checkOutTime })} inputMode="numeric" placeholder="11:00" />
            <TextInput label="Time zone" hint="Such as Europe/Lisbon. Found from the address when known" value={form.stayZone} onChange={(stayZone) => set({ stayZone })} />
          </div>
        </fieldset>
      ) : (
        form.legs.map((leg, index) => (
          <fieldset key={index}>
            <legend>{journey ? (form.legs.length > 1 ? `Leg ${index + 1}` : form.kind === "flight" ? "Flight" : "Train") : form.kind === "car" ? "Pick-up and return" : "When and where"}</legend>
            <div className="ri-form-grid">
              {journey && <TextInput label={form.kind === "flight" ? "Flight number" : "Train"} value={leg.number} onChange={(number) => setLeg(index, { number })} placeholder={form.kind === "flight" ? "RA 204" : "Coast Line 11"} />}
              {(journey || form.kind === "car") && <TextInput label={form.kind === "car" ? "Pick-up place" : "From"} value={leg.fromLabel} onChange={(fromLabel) => setLeg(index, { fromLabel })} />}
              {(form.kind === "flight" || form.kind === "car") && <TextInput label="Airport code" hint="Optional, sets the time zone" value={leg.fromCode} onChange={(fromCode) => setLeg(index, { fromCode: fromCode.toUpperCase() })} maxLength={3} />}
              <DateInput label={journey ? "Departure date" : form.kind === "car" ? "Pick-up date" : "Date"} value={leg.startDate} onChange={(startDate) => setLeg(index, { startDate })} required />
              <TextInput label={journey ? "Departure time" : form.kind === "car" ? "Pick-up time" : "Start time"} hint="Local, 24-hour" value={leg.startTime} onChange={(startTime) => setLeg(index, { startTime })} inputMode="numeric" placeholder="08:40" />
              <TextInput label={journey ? "Departure time zone" : "Time zone"} hint="Such as America/Denver" value={leg.startZone} onChange={(startZone) => setLeg(index, { startZone })} />
              {(journey || form.kind === "car") && <TextInput label={form.kind === "car" ? "Return place" : "To"} value={leg.toLabel} onChange={(toLabel) => setLeg(index, { toLabel })} />}
              {form.kind === "flight" && <TextInput label="Arrival airport code" hint="Optional, sets the time zone" value={leg.toCode} onChange={(toCode) => setLeg(index, { toCode: toCode.toUpperCase() })} maxLength={3} />}
              <DateInput label={journey ? "Arrival date" : form.kind === "car" ? "Return date" : "End date"} hint={form.kind === "activity" ? "Optional" : undefined} value={leg.endDate} onChange={(endDate) => setLeg(index, { endDate })} />
              <TextInput label={journey ? "Arrival time" : form.kind === "car" ? "Return time" : "End time"} hint="Local, 24-hour" value={leg.endTime} onChange={(endTime) => setLeg(index, { endTime })} inputMode="numeric" />
              {journey && <TextInput label="Arrival time zone" hint="Such as Europe/Lisbon" value={leg.endZone} onChange={(endZone) => setLeg(index, { endZone })} />}
              {!journey && <TextInput label={form.kind === "car" ? "Pick-up address" : "Location"} value={leg.address} onChange={(address) => setLeg(index, { address })} maxLength={400} />}
            </div>
            {journey && form.legs.length > 1 && <Button variant="link" size="sm" onClick={() => onChange({ ...form, legs: form.legs.filter((_, position) => position !== index) })}>Remove this leg</Button>}
          </fieldset>
        ))
      )}
      {form.kind === "flight" && form.legs.length < 8 && <Button variant="quiet" size="sm" onClick={() => onChange({ ...form, legs: [...form.legs, emptyLeg()] })}>Add a leg</Button>}
    </div>
  );
}

/** Field paths whose values differ between two forms, for a correction patch. */
function patchOf(before: FormState, after: FormState, booking: Booking) {
  const patch: Record<string, unknown> = {};
  const travelers = (value: string) => value.split(",").map((name) => name.trim()).filter(Boolean);
  if (after.title.trim() !== before.title.trim() && after.title.trim()) patch.title = after.title.trim();
  if (after.provider !== before.provider) patch.provider = blank(after.provider);
  if (after.reference !== before.reference) patch.reference = blank(after.reference);
  if (after.travelers !== before.travelers) patch.travelers = travelers(after.travelers);
  if (after.status !== before.status) patch.status = after.status;
  if (booking.stay) {
    const stay: Record<string, unknown> = {};
    if (after.propertyName !== before.propertyName && after.propertyName.trim()) stay.propertyName = after.propertyName.trim();
    if (after.stayAddress !== before.stayAddress) stay.address = blank(after.stayAddress);
    if (after.checkInDate !== before.checkInDate && after.checkInDate) stay.checkInDate = after.checkInDate;
    if (after.checkOutDate !== before.checkOutDate && after.checkOutDate) stay.checkOutDate = after.checkOutDate;
    if (after.checkInTime !== before.checkInTime) stay.checkInTime = blank(after.checkInTime);
    if (after.checkOutTime !== before.checkOutTime) stay.checkOutTime = blank(after.checkOutTime);
    if (after.stayZone !== before.stayZone) stay.zone = blank(after.stayZone);
    if (Object.keys(stay).length) patch.stay = stay;
  }
  const segments = booking.segments.map((segment, index) => {
    const a = after.legs[index], b = before.legs[index];
    if (!a || !b) return null;
    const item: Record<string, unknown> = { sequence: segment.sequence };
    if (a.number !== b.number) item.number = blank(a.number);
    if (a.fromLabel !== b.fromLabel) item.originLabel = blank(a.fromLabel);
    if (a.fromCode !== b.fromCode) item.originCode = blank(a.fromCode);
    if (a.toLabel !== b.toLabel) item.destinationLabel = blank(a.toLabel);
    if (a.toCode !== b.toCode) item.destinationCode = blank(a.toCode);
    if (a.startDate !== b.startDate || a.startTime !== b.startTime) item.startLocal = local(a.startDate, a.startTime);
    if (a.startZone !== b.startZone) item.startZone = blank(a.startZone);
    if (a.endDate !== b.endDate || a.endTime !== b.endTime) item.endLocal = local(a.endDate ?? (a.endTime.trim() ? a.startDate : null), a.endTime);
    if (a.endZone !== b.endZone) item.endZone = blank(a.endZone);
    if (a.address !== b.address) item.address = blank(a.address);
    return Object.keys(item).length > 1 ? item : null;
  }).filter(Boolean);
  if (segments.length) patch.segments = segments;
  return patch;
}

/** Correct an imported or entered booking. Imported values are kept beside the correction. */
export function CorrectDialog({ booking, onClose }: { booking: Booking; onClose(): void }) {
  const save = useMutation<Record<string, unknown>, Write<Booking>>("save_booking");
  const announce = useAnnounce();
  // Opened once per correction. Refreshes underneath never reset what was typed.
  const [original, setOriginal] = useState(() => formFromBooking(booking));
  const [form, setForm] = useState(original);
  const [revision, setRevision] = useState(booking.revision);
  const [conflict, setConflict] = useState<Booking | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { setProblem(null); }, [form]);
  const submit = async (expectedRevision: number, base: FormState) => {
    const check = draftFromForm(form);
    if (check.problem) return setProblem(check.problem);
    const patch = patchOf(base, form, booking);
    if (!Object.keys(patch).length) return onClose();
    try {
      const result = await save.run({ id: booking.id, expectedRevision, patch });
      if (result.status === "conflict") { setConflict(result.current); return; }
      announce(booking.method === "manual" ? "Booking saved" : "Correction saved. The original value is kept with its source");
      onClose();
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  const fields = conflict ? diffFields(form, formFromBooking(conflict)) : [];
  return (
    <Dialog open title={booking.method === "manual" ? "Edit booking" : "Correct booking details"} wide onClose={onClose} busy={save.pending}
      description={booking.method === "manual" ? "You entered this booking, so changes replace the values." : "Your correction keeps the original value from the source. Future imports will not overwrite it. If a newer confirmation disagrees, Review shows both."}
      footer={<><Button variant="quiet" onClick={onClose} disabled={save.pending}>Cancel</Button><Button variant="primary" busy={save.pending} busyLabel="Saving" onClick={() => void submit(revision, original)}>Save correction</Button></>}>
      {conflict && (
        <ConflictNotice
          fields={fields.length ? fields : [{ label: "Booking", mine: "Your edits", current: "Changed by a newer update" }]}
          busy={save.pending}
          onKeepMine={() => { const next = conflict; setConflict(null); setRevision(next.revision); const base = formFromBooking(next); setOriginal(base); return submit(next.revision, base); }}
          onUseCurrent={() => { const next = formFromBooking(conflict); setOriginal(next); setForm(next); setRevision(conflict.revision); setConflict(null); }}
        />
      )}
      <BookingFields form={form} onChange={setForm} fixedKind />
      <InlineError>{problem ?? cleanError(save.error)}</InlineError>
    </Dialog>
  );
}

function diffFields(mine: FormState, current: FormState) {
  const rows: { label: string; mine: string; current: string }[] = [];
  const add = (label: string, a: string | null, b: string | null) => { if ((a ?? "") !== (b ?? "")) rows.push({ label, mine: a || "Not provided", current: b || "Not provided" }); };
  add("Title", mine.title, current.title);
  add("Confirmation", mine.reference, current.reference);
  add("Travelers", mine.travelers, current.travelers);
  add("Status", mine.status, current.status);
  add("Check-in", `${mine.checkInDate ?? ""} ${mine.checkInTime}`.trim(), `${current.checkInDate ?? ""} ${current.checkInTime}`.trim());
  add("Check-out", `${mine.checkOutDate ?? ""} ${mine.checkOutTime}`.trim(), `${current.checkOutDate ?? ""} ${current.checkOutTime}`.trim());
  mine.legs.forEach((leg, index) => {
    const other = current.legs[index];
    if (!other) return;
    add(`Start${mine.legs.length > 1 ? ` (leg ${index + 1})` : ""}`, `${leg.startDate ?? ""} ${leg.startTime}`.trim(), `${other.startDate ?? ""} ${other.startTime}`.trim());
    add(`End${mine.legs.length > 1 ? ` (leg ${index + 1})` : ""}`, `${leg.endDate ?? ""} ${leg.endTime}`.trim(), `${other.endDate ?? ""} ${other.endTime}`.trim());
  });
  return rows;
}
