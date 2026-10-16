/**
 * Two-step import of a chosen file or pasted confirmation. Preview reads the
 * source (PDF text through Ri's extract_text), parses it and stores the parse
 * under an expiring preview ID and digest without changing any booking. Apply
 * applies exactly that stored parse once: a retry, a second click or the same
 * file applied again changes nothing more.
 */
import { z } from "zod/v4";
import { AppError } from "@ri/app-kit/contract";
import { allows, sha256, type AccessScope } from "@ri/app-kit/data";
import type { AppInvocation } from "@ri/app-kit/sdk";
import { htmlToText } from "@ri/app-kit/sources";
import { displayValue } from "../domain/booking.js";
import { matchBookings, matchTrips } from "../domain/match.js";
import { bookingDraftSchema, fieldLabel, IMPORTS_SOURCE, KIND_LABELS, type ParseResult, type ParsedBooking } from "../domain/model.js";
import { isComplete, parseConfirmation, type ParseInvite } from "../domain/parse/extract.js";
import type { applyImportInput, previewImportInput } from "../actions/schemas.js";
import { aiExtract } from "./ai.js";
import type { Travel } from "./core.js";
import { canonicalText, createIntake } from "./evidence.js";
import { readEmailFile } from "./mime.js";
import { completeDraft } from "./writes.js";
import { clip, createReadModel, dateLabel } from "./records.js";
import { destinationOf } from "./ingest.js";

type PreviewInput = z.infer<typeof previewImportInput>;
type ApplyInput = z.infer<typeof applyImportInput>;
type ApplyOutcome = { item: number; action: "created" | "duplicate" | "updated" | "canceled" | "review" | "unchanged" | "skipped"; bookingId: string | null; tripId: string | null; reviewId: string | null; message: string };
type ApplyResult = { status: "applied" | "already_applied" | "nothing_to_apply"; evidenceId: string | null; outcomes: ApplyOutcome[]; openTripId: string | null; message: string };
const PREVIEW_MS = 60 * 60_000;

interface StoredPreview {
  parse: ParseResult;
  text: string;
  subject: string | null;
  sender: { name: string | null; address: string | null } | null;
  receivedAt: string | null;
  invite: ParseInvite | null;
}

export function createImports(t: Travel) {
  const { repo } = t;
  const read = createReadModel(t);
  const intake = createIntake(t);

  async function readSource(invocation: AppInvocation, input: PreviewInput) {
    const notes: string[] = [];
    if (input.kind === "paste") {
      let text = (input.text ?? "").trim();
      if (!text) throw new AppError("invalid_input", "Paste the confirmation text first");
      // A pasted email often keeps its header lines. Use them, and keep the body as the text.
      const headers: Record<string, string> = {};
      const lines = text.split(/\r?\n/);
      let index = 0;
      while (index < Math.min(lines.length, 8)) {
        const match = /^(Subject|From|Date|To|Sent):\s*(.+)$/i.exec(lines[index].trim());
        if (!match) break;
        headers[match[1].toLowerCase()] = match[2].trim();
        index++;
      }
      if (Object.keys(headers).length && headers.subject) text = lines.slice(index).join("\n").trim() || text;
      const from = headers.from ? /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(headers.from) : null;
      const sender = from ? { name: from[1].trim() || null, address: from[2].trim() } : headers.from && /@/.test(headers.from) ? { name: null, address: headers.from } : null;
      const date = headers.date || headers.sent;
      const receivedAt = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null;
      return { text, bytes: null as Buffer | null, subject: headers.subject ?? null, sender, receivedAt, invite: null, truncated: false, extraction: "deterministic" as const, notes };
    }
    if (!input.base64 || !input.mimeType || !input.fileName) throw new AppError("invalid_input", "Choose a file to import");
    const bytes = Buffer.from(input.base64, "base64");
    if (bytes.byteLength > 512 * 1024) throw new AppError("invalid_input", "The file is larger than 512 KB. Paste the confirmation text instead");
    if (input.mimeType === "text/plain") return { text: bytes.toString("utf8"), bytes, subject: null, sender: null, receivedAt: null, invite: null, truncated: false, extraction: "deterministic" as const, notes };
    if (input.mimeType === "text/html") return { text: htmlToText(bytes.toString("utf8")), bytes, subject: null, sender: null, receivedAt: null, invite: null, truncated: false, extraction: "deterministic" as const, notes };
    if (input.mimeType === "message/rfc822") {
      const email = readEmailFile(bytes.toString("utf8"));
      const date = email.date && !Number.isNaN(Date.parse(email.date)) ? new Date(email.date).toISOString() : null;
      const invite = email.invite ? { method: email.invite.method, uid: email.invite.uid, summary: email.invite.summary, start: email.invite.start, end: email.invite.end, status: email.invite.status, sequence: email.invite.sequence } : null;
      if (email.attachments.length) notes.push(`Attachments in the saved email are not read: ${email.attachments.slice(0, 3).join(", ")}. Import an attachment as its own file if it holds the booking.`);
      return { text: email.text, bytes, subject: email.subject || null, sender: email.from, receivedAt: date, invite, truncated: false, extraction: "deterministic" as const, notes };
    }
    try {
      const result = z.object({ text: z.string(), truncated: z.boolean().optional() }).passthrough().parse(await invocation.capability("extract_text", { fileName: input.fileName, mimeType: input.mimeType, base64: input.base64 }));
      if (!result.text.trim()) notes.push("This PDF has no readable text, such as a scan. Enter the details by hand. The file is kept with the booking.");
      return { text: result.text, bytes, subject: null, sender: null, receivedAt: null, invite: null, truncated: !!result.truncated, extraction: "deterministic" as const, notes };
    } catch (error) {
      const code = (error as AppError)?.code;
      if (code === "forbidden" || code === "unsupported" || code === "invalid_input") {
        notes.push(code === "forbidden" ? "Travel is not allowed to read files yet. Allow file reading in Sources, or enter the details by hand." : "This file could not be read. Enter the details by hand. The file is kept with the booking.");
        return { text: "", bytes, subject: null, sender: null, receivedAt: null, invite: null, truncated: false, extraction: "unavailable" as const, notes };
      }
      throw error;
    }
  }

  function previewItem(scope: AccessScope, parsed: ParsedBooking, index: number) {
    const complete = isComplete(parsed) && !parsed.ambiguous.length;
    const draft = bookingDraftSchema.safeParse(parsed.draft);
    const all = repo.bookings(scope);
    const match = draft.success ? matchBookings({ draft: draft.data, kindGuessed: parsed.kindGuessed, provider: draft.data.provider ?? null }, all).candidates : [];
    const target = match.length === 1 ? match[0] : null;
    let changes: { field: string; label: string; current: string; proposed: string }[] = [];
    if (target && !parsed.cancellation) {
      const { diffs } = t.ingest("preview").differences(target, parsed);
      changes = diffs.map((diff) => ({ field: diff.path, label: fieldLabel(diff.path, target.kind), current: clip(displayValue(diff.path, diff.before), 400), proposed: clip(displayValue(diff.path, diff.after), 400) }));
    }
    let suggestedTripId: string | null = target?.tripId ?? null;
    let placement: string;
    const dates = parsed.draft.stay ? [parsed.draft.stay.checkInDate, parsed.draft.stay.checkOutDate] : (parsed.draft.segments ?? []).flatMap((segment) => [segment.startLocal.slice(0, 10), segment.endLocal?.slice(0, 10)]).filter((value): value is string => !!value).sort();
    if (parsed.cancellation) placement = target ? `Marks ${target.title} canceled.` : "No matching booking is recorded, so nothing would change.";
    else if (target) {
      const tripName = target.tripId ? repo.trip(target.tripId)?.title : null;
      placement = changes.length ? `Updates ${target.title}${tripName ? ` in ${tripName}` : ""}.` : `Already recorded as ${target.title}.`;
    }
    else if (match.length > 1) placement = "More than one recorded booking could match. It will wait in Review.";
    else {
      const trips = repo.trips().filter((trip) => !trip.archivedAt && read.visibleTrip(scope, trip).full);
      const fits = matchTrips({ first: dates[0] ?? null, last: dates.at(-1) ?? null, travelers: parsed.draft.travelers ?? [] }, trips.map((trip) => ({ id: trip.id, startDate: trip.startDate, endDate: trip.endDate, travelers: trip.travelers, destinations: trip.destinations, archived: false })));
      if (fits.length === 1) { suggestedTripId = fits[0].id; placement = `Adds to ${trips.find((trip) => trip.id === fits[0].id)!.title}.`; }
      else if (fits.length > 1) placement = "Fits more than one trip. Choose one.";
      else placement = `Starts a new trip${destinationOf(parsed.draft, t.settings.get().homeZone) ? `, ${destinationOf(parsed.draft, t.settings.get().homeZone)}` : ""}.`;
    }
    const suggestedTrip = suggestedTripId ? repo.trip(suggestedTripId) : null;
    const title = parsed.draft.title ?? parsed.draft.stay?.propertyName ?? KIND_LABELS[parsed.draft.kind];
    return {
      item: index, draft: draft.success ? draft.data : null, kindLabel: KIND_LABELS[parsed.draft.kind],
      summary: clip(`${title}, ${dateLabel(dates[0] ?? null, dates.at(-1) ?? null)}${parsed.draft.reference ? `, confirmation ${parsed.draft.reference}` : ""}`, 300),
      complete, missing: parsed.missing.slice(0, 30).map((value) => clip(value, 60)), ambiguous: parsed.ambiguous.slice(0, 10).map((item) => clip(item.reason, 300)),
      passages: parsed.passages.slice(0, 20).map((value) => clip(value, 600)), cancellation: parsed.cancellation, change: parsed.change,
      match: target ? { bookingId: target.id, title: clip(target.title, 200), changes: changes.slice(0, 40) } : null,
      suggestedTripId: suggestedTrip ? suggestedTrip.id : null, suggestedTripTitle: suggestedTrip ? clip(suggestedTrip.title, 200) : null, placement: clip(placement, 300),
    };
  }

  async function preview(invocation: AppInvocation, scope: AccessScope, input: PreviewInput) {
    if (!allows(scope, IMPORTS_SOURCE)) throw new AppError("forbidden", "This caller may not import confirmations");
    const source = await readSource(invocation, input);
    const text = canonicalText(source.subject, source.text);
    let parse = source.text.trim()
      ? parseConfirmation({ text, subject: source.subject, senderName: source.sender?.name ?? null, senderAddress: source.sender?.address ?? null, receivedAt: source.receivedAt ?? t.now().toISOString(), invite: source.invite })
      : { bookings: [], forwarded: false, travelLike: false, notes: [] } satisfies ParseResult;
    let extraction: "deterministic" | "none" | "unavailable" | "ai" = source.extraction === "unavailable" ? "unavailable" : parse.bookings.length ? "deterministic" : "none";
    const notes = [...source.notes, ...parse.notes];
    if (!parse.bookings.length && source.text.trim() && t.settings.get().aiExtraction) {
      const result = await aiExtract(invocation, text, { subject: source.subject, receivedAt: source.receivedAt ?? t.now().toISOString() });
      if (result.status === "ok") { parse = { ...parse, bookings: result.bookings }; extraction = "ai"; notes.push("Suggested by AI extraction. Check every field against the quoted passages before applying."); }
      else notes.push(result.reason);
    }
    if (source.truncated) notes.push("Only the first part of this file could be read.");
    const sourceDigest = sha256(source.bytes ?? Buffer.from(source.text, "utf8"));
    const stored: StoredPreview = { parse, text: source.text, subject: source.subject, sender: source.sender, receivedAt: source.receivedAt, invite: source.invite };
    const digest = sha256(JSON.stringify([sourceDigest, parse.bookings.map((booking) => booking.draft)]));
    const expiresAt = new Date(t.now().getTime() + PREVIEW_MS).toISOString();
    repo.prunePreviews();
    const previewId = repo.insertPreview({
      actor: t.actor(invocation), kind: input.kind, fileName: input.fileName ?? null, mimeType: input.mimeType ?? null, sourceDigest, digest,
      fileBlob: source.bytes ? t.blobs.put(source.bytes).digest : null, textBlob: intake.storeText(source.text), parse: stored, expiresAt,
    });
    const trips = repo.trips().filter((trip) => !trip.archivedAt && allows(scope, trip.sourceKey)).slice(0, 50);
    return {
      previewId, digest, expiresAt, fileName: input.fileName ?? null, characters: source.text.length, truncated: source.truncated, forwarded: parse.forwarded,
      items: parse.bookings.slice(0, 20).map((booking, index) => previewItem(scope, booking, index)),
      notes: [...new Set(notes)].slice(0, 10).map((note) => clip(note, 300)),
      excerpt: clip(source.text, 4000),
      trips: trips.map((trip) => ({ id: trip.id, title: clip(trip.title, 200), dateLabel: dateLabel(trip.startDate, trip.endDate) })),
      extraction,
    };
  }

  function apply(invocation: AppInvocation, scope: AccessScope, input: ApplyInput) {
    if (!allows(scope, IMPORTS_SOURCE)) throw new AppError("forbidden", "This caller may not import confirmations");
    return t.store.mutate(invocation, "apply_import", input, (): ApplyResult => {
      const stored = repo.preview(input.previewId);
      if (!stored) throw new AppError("invalid_input", "This preview is no longer available. Choose the file again");
      if (stored.actor !== t.actor(invocation)) throw new AppError("forbidden", "This preview belongs to someone else");
      if (stored.digest !== input.digest) throw new AppError("conflict", "The preview changed. Review it again before applying");
      if (stored.appliedAt) return { ...(stored.result as ApplyResult), status: "already_applied" };
      if (stored.expiresAt < t.now().toISOString()) throw new AppError("invalid_input", "This preview expired. Choose the file again");
      const preview = stored.parse as StoredPreview;
      if (!preview.parse.bookings.length && !input.manual) return { status: "nothing_to_apply", evidenceId: null, outcomes: [], openTripId: null, message: "Nothing was found to add. Enter the details by hand to keep this file with a booking." };
      const bytes = stored.fileBlob ? t.blobs.read(stored.fileBlob) : null;
      const evidence = intake.imported({ kind: stored.kind, text: preview.text, fileName: stored.fileName, mimeType: stored.mimeType, bytes, subject: preview.subject, sender: preview.sender, receivedAt: preview.receivedAt, invite: preview.invite }, preview.parse);
      const ingest = t.ingest(t.actor(invocation));
      const outcomes: ApplyOutcome[] = [];
      preview.parse.bookings.slice(0, 20).forEach((parsed, index) => {
        const decision = input.decisions?.find((item) => item.item === index);
        if (decision && !decision.include) { outcomes.push({ item: index, action: "skipped", bookingId: null, tripId: null, reviewId: null, message: "Skipped." }); return; }
        if (decision?.tripId) {
          const trip = repo.trip(decision.tripId);
          if (!trip || !allows(scope, trip.sourceKey)) throw new AppError("not_found", "That trip is no longer available");
        }
        const complete = isComplete(parsed) && !parsed.ambiguous.length;
        const outcome = ingest.apply(evidence, parsed, {
          // The person reviewed the preview, which named the booking a cancellation matches. Incomplete or ambiguous items still wait in Review.
          reviewed: complete || parsed.cancellation,
          ...(decision?.tripId !== undefined ? { tripId: decision.tripId } : {}),
          ...(decision?.newTripTitle ? { newTripTitle: decision.newTripTitle } : {}),
        });
        outcomes.push({ item: index, ...outcome, message: clip(outcome.message, 300) });
      });
      if (input.manual) {
        const draft = completeDraft(bookingDraftSchema.parse(input.manual));
        if (input.manualTripId) {
          const trip = repo.trip(input.manualTripId);
          if (!trip || !allows(scope, trip.sourceKey)) throw new AppError("not_found", "That trip is no longer available");
        }
        const outcome = ingest.apply(evidence, { draft, passages: [], missing: [], ambiguous: [], change: false, cancellation: false, method: "deterministic" }, { reviewed: true, forceNew: true, ...(input.manualTripId !== undefined ? { tripId: input.manualTripId } : {}) });
        if (outcome.bookingId) repo.run("UPDATE bookings SET method = 'manual' WHERE id = ?", outcome.bookingId);
        repo.updateEvidence(evidence.id, { parseStatus: "parsed", parseMethod: "manual", parseNote: "Details entered by hand" });
        outcomes.push({ item: preview.parse.bookings.length, ...outcome, message: clip(outcome.message, 300) });
      }
      const open = outcomes.find((item) => item.tripId)?.tripId ?? null;
      const added = outcomes.filter((item) => item.action === "created").length;
      const reviews = outcomes.filter((item) => item.reviewId).length;
      const value: ApplyResult = {
        status: "applied", evidenceId: evidence.id, outcomes, openTripId: open,
        message: clip([added ? `Added ${added} booking${added === 1 ? "" : "s"}` : null, outcomes.some((item) => item.action === "updated") ? "Updated a booking" : null, outcomes.some((item) => item.action === "duplicate" || item.action === "unchanged") ? "Already recorded" : null, reviews ? `${reviews} waiting in Review` : null].filter(Boolean).join(". ") || "Applied.", 300),
      };
      repo.markPreviewApplied(stored.id, value);
      return value;
    });
  }
  return { preview, apply };
}
