/**
 * Bounded background work. One call runs one step for one account: a Gmail
 * page with at most ten bodies, a Calendar page, or a small enrichment batch
 * (reading a booking attachment, or the opted-in AI fallback). Records and
 * the checkpoint commit together. Nothing loops or starts a timer. Deleted
 * mail marks its evidence "Source unavailable" and never cancels a booking.
 */
import { AppError } from "@ri/app-kit/contract";
import { accountSource, redact, transaction, type JobRecord } from "@ri/app-kit/data";
import type { AppInvocation } from "@ri/app-kit/sdk";
import { calendarSyncStep, emailDomain, gmailSyncStep, newCalendarCheckpoint, type CalendarCheckpoint, type CalendarEvent, type MailCheckpoint, type MailHeaders } from "@ri/app-kit/sources";
import { parseConfirmation } from "../domain/parse/extract.js";
import { aiExtract } from "./ai.js";
import { CALENDAR_FUTURE_DAYS, CALENDAR_PAST_DAYS, DEFAULT_HISTORY_DAYS, type Travel } from "./core.js";
import { canonicalText, createIntake } from "./evidence.js";

const PROVIDERS = [
  "airbnb", "booking.com", "expedia", "hotels.com", "vrbo", "kayak", "tripit", "trip.com", "agoda", "priceline", "hopper", "orbitz", "travelocity",
  "hertz", "avis", "enterprise", "sixt", "budget", "europcar", "alamo", "nationalcar", "turo",
  "amtrak", "eurostar", "trainline", "sncf", "renfe", "trenitalia", "italotreno", "bahn.de", "viarail", "cp.pt",
  "delta", "united", "aa.com", "southwest", "jetblue", "alaskaair", "aircanada", "westjet", "britishairways", "lufthansa", "airfrance", "klm", "flytap", "iberia",
  "ryanair", "easyjet", "emirates", "qatarairways", "singaporeair", "cathaypacific", "ana.co.jp", "jal", "qantas", "aeromexico", "latam", "avianca", "turkishairlines", "swiss.com", "virginatlantic", "frontier", "spirit",
  "marriott", "hilton", "hyatt", "ihg", "accor", "wyndham", "choicehotels", "bestwestern", "radisson", "fourseasons",
  "opentable", "resy", "sevenrooms", "tock", "getyourguide", "viator", "klook", "tiqets", "eventbrite",
];
const SUBJECT_TERMS = ["confirmation", "confirmed", "itinerary", "reservation", "booking", "e-ticket", "eticket", "boarding pass", "your trip", "your stay", "your flight", "check-in", "cancellation", "schedule change", "trip details"];
/** Travel confirmations from airlines, hotels, rail, car rental and booking platforms. Combined with the history window by the sync step. */
export const GMAIL_QUERY = `{${SUBJECT_TERMS.map((term) => `subject:${term.includes(" ") || term.includes("-") ? `"${term}"` : term}`).join(" ")} ${PROVIDERS.map((name) => `from:${name}`).join(" ")}} -category:promotions -category:social -in:chats -in:drafts`;

const SUBJECT_RELEVANT = /\b(?:confirm(?:ation|ed)|itinerary|reservation|booking|e-?ticket|boarding\s+pass|your\s+(?:trip|stay|flight|train|car)|check-?in|cancell?(?:ation|ed)|schedule\s+change|flight|hotel|rental)\b/i;
const SNIPPET_RELEVANT = /\b(?:confirmation\s+(?:number|code)|booking\s+(?:reference|number)|record\s+locator|check-?in|check-?out|departure|pick-?up|itinerary|reservation\s+(?:number|confirmed))\b/i;
/** Cheap header check for new mail before reading a body. */
export function headerRelevant(headers: MailHeaders): boolean {
  if (headers.labelIds.some((label) => ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "SPAM", "TRASH", "DRAFT", "SENT"].includes(label))) return false;
  if (SUBJECT_RELEVANT.test(headers.subject)) return true;
  const domain = headers.from ? emailDomain(headers.from.address) ?? "" : "";
  if (PROVIDERS.some((name) => domain.includes(name.replace(/\.com$/, "")))) return SNIPPET_RELEVANT.test(headers.snippet) || /\b(?:trip|travel|flight|stay|reservation)\b/i.test(headers.subject);
  return SNIPPET_RELEVANT.test(headers.snippet);
}

export interface StepSummary { ran: boolean; kind: string | null; source: string | null; more: boolean; summary: string; read: number; added: number; review: number; skipped: number; removed: number }
const idle = (summary: string): StepSummary => ({ ran: false, kind: null, source: null, more: false, summary, read: 0, added: 0, review: 0, skipped: 0, removed: 0 });
const IDLE_MS = 4 * 60_000;
const kindOfBinding = (binding: string) => (binding === "mail" ? "mail" : binding === "calendar" ? "calendar" : null);

export function createSync(t: Travel) {
  const { repo, jobs, accounts, mailIndex, db } = t;
  const intake = createIntake(t);

  function markRemoved(account: string, messageId: string, actor: string) {
    const evidence = repo.evidenceByExternal(accountSource(account), messageId);
    mailIndex.record(account, messageId, evidence?.threadId ?? messageId, "removed");
    if (!evidence || evidence.availability === "unavailable") return;
    repo.updateEvidence(evidence.id, { availability: "unavailable", unavailableAt: repo.iso() });
    for (const link of repo.linksForEvidence(evidence.id))
      repo.addChange({ bookingId: link.bookingId, evidenceId: evidence.id, kind: "source_unavailable", fields: [], actor, sourceKey: evidence.sourceKey, note: "The confirmation email was deleted or moved to Trash in Gmail. The booking is unchanged and nothing was canceled." });
  }
  function restore(account: string, messageId: string, actor: string) {
    const evidence = repo.evidenceByExternal(accountSource(account), messageId);
    if (!evidence || evidence.availability === "available") return;
    repo.updateEvidence(evidence.id, { availability: "available", unavailableAt: null });
    mailIndex.record(account, messageId, evidence.threadId ?? messageId, "kept");
    for (const link of repo.linksForEvidence(evidence.id))
      repo.addChange({ bookingId: link.bookingId, evidenceId: evidence.id, kind: "source_restored", fields: [], actor, sourceKey: evidence.sourceKey, note: "The confirmation email is back in Gmail." });
  }

  async function mailStep(invocation: AppInvocation, account: string, actor: string): Promise<Omit<StepSummary, "ran" | "kind" | "source">> {
    const stored = accounts.get(account, "mail")!;
    const deadline = Math.min(invocation.deadline - 5_000, Date.now() + 20_000);
    let added = 0, review = 0;
    // The step's records are applied with its checkpoint in one transaction. A failure part way
    // still keeps the messages already read, without moving the checkpoint, so the page resumes.
    const pending: (() => void)[] = [];
    const buffered = new Set<string>();
    const apply = () => { for (const operation of pending.splice(0)) operation(); };
    let result: Awaited<ReturnType<typeof gmailSyncStep>>;
    try {
      result = await gmailSyncStep({
        invocation, account, binding: "mail", checkpoint: stored.checkpoint as MailCheckpoint | null, windowDays: stored.historyDays, query: GMAIL_QUERY, deadline, now: t.now,
        seen: (id) => buffered.has(id) || mailIndex.seen(account, id),
        relevant: headerRelevant,
        ingest: (message) => {
          buffered.add(message.id);
          pending.push(() => {
            const outcome = intake.mailMessage(account, message, actor);
            mailIndex.record(account, message.id, message.threadId, outcome.kept ? "kept" : "skipped", { receivedAt: message.receivedAt, digest: message.digest });
            added += outcome.outcomes.filter((item) => item.action === "created").length;
            review += outcome.outcomes.filter((item) => !!item.reviewId).length + (outcome.evidence?.parseStatus === "unreadable" ? 1 : 0);
          });
        },
        skip: (id, thread) => { buffered.add(id); pending.push(() => mailIndex.record(account, id, thread, "skipped")); },
        removed: (id) => pending.push(() => markRemoved(account, id, actor)),
        relabeled: (id, labels, wasAdded) => { if (!wasAdded && labels.some((label) => label === "TRASH" || label === "SPAM")) pending.push(() => restore(account, id, actor)); },
      });
    } catch (error) {
      if (pending.length) transaction(db, apply);
      throw error;
    }
    transaction(db, () => {
      apply();
      accounts.commit(account, "mail", result.checkpoint, result.checkpoint.backfill.complete ? "ready" : "importing", result.checkpoint.emailAddress);
    });
    const parts = [
      result.lane === "profile" ? "Found the mailbox position" : `Checked ${result.lane === "history" ? "new mail" : "older mail"}`,
      result.read ? `read ${result.read} message${result.read === 1 ? "" : "s"}` : null,
      added ? `added ${added} booking${added === 1 ? "" : "s"}` : null,
      review ? `${review} to review` : null,
      result.removed ? `${result.removed} source${result.removed === 1 ? "" : "s"} no longer in Gmail` : null,
    ].filter(Boolean);
    return { more: result.more, summary: parts.join(", "), read: result.read, added, review, skipped: result.skipped, removed: result.removed };
  }

  function storeEvent(account: string, calendarId: string, event: CalendarEvent) {
    const allDay = event.allDay || (event.start?.length ?? 0) === 10;
    const normalize = (value: string | undefined) => (!value ? null : allDay ? value.slice(0, 10) : Number.isNaN(Date.parse(value)) ? null : new Date(value).toISOString());
    const self = event.attendees.find((attendee) => attendee.self);
    repo.upsertCalendarEvent({
      account, calendarId, occurrenceKey: event.recurringEventId ? `${event.recurringEventId}@${event.originalStartTime?.dateTime ?? event.originalStartTime?.date ?? event.id}` : event.id,
      summary: event.summary?.slice(0, 300) ?? null, location: event.location?.slice(0, 300) ?? null, startValue: normalize(event.start), endValue: normalize(event.end), allDay,
      startZone: event.startTimeZone ?? null, status: event.status ?? null, cancelled: event.cancelled, transparent: (event as { transparency?: string }).transparency === "transparent",
      response: self?.responseStatus ?? event.responseStatus ?? null, sourceKey: accountSource(account),
    });
  }

  async function calendarStep(invocation: AppInvocation, account: string): Promise<Omit<StepSummary, "ran" | "kind" | "source">> {
    const stored = accounts.get(account, "calendar")!;
    const checkpoints = { ...((stored.checkpoint ?? {}) as Record<string, CalendarCheckpoint>) };
    if (!stored.calendars.length) return { more: false, summary: "No calendars chosen", read: 0, added: 0, review: 0, skipped: 0, removed: 0 };
    const pending = stored.calendars.find((id) => !checkpoints[id]?.completedAt || checkpoints[id]?.pageToken) ?? [...stored.calendars].sort((a, b) => (checkpoints[a]?.lastSuccessAt ?? "").localeCompare(checkpoints[b]?.lastSuccessAt ?? ""))[0];
    // The history range reaches back for past events. The future window covers trips planned up to a year ahead.
    const checkpoint = checkpoints[pending] ?? newCalendarCheckpoint(pending, Math.max(CALENDAR_PAST_DAYS, stored.historyDays), CALENDAR_FUTURE_DAYS, t.now());
    const events: CalendarEvent[] = [];
    const result = await calendarSyncStep({ invocation, account, binding: "calendar", checkpoint, now: t.now, ingest: (event) => { events.push(event); } });
    checkpoints[pending] = result.checkpoint;
    const complete = stored.calendars.every((id) => checkpoints[id]?.completedAt && !checkpoints[id]?.pageToken);
    const count = events.length;
    // The page's events and its checkpoint commit together.
    transaction(db, () => {
      for (const event of events) storeEvent(account, pending, event);
      accounts.commit(account, "calendar", checkpoints, complete ? "ready" : "importing");
    });
    return { more: result.more || !complete, summary: `Checked calendar events, ${count} updated`, read: count, added: 0, review: 0, skipped: 0, removed: 0 };
  }

  async function enrichStep(invocation: AppInvocation, source: string, actor: string): Promise<Omit<StepSummary, "ran" | "kind" | "source">> {
    const account = source.replace(/^account:/, "");
    const aiEnabled = t.settings.get().aiExtraction;
    const statuses: ("pending_attachment" | "pending_ai")[] = aiEnabled ? ["pending_attachment", "pending_ai"] : ["pending_attachment"];
    const batch = repo.evidenceByStatus(statuses, [source], 3);
    const deadline = Math.min(invocation.deadline - 5_000, Date.now() + 30_000);
    let read = 0, added = 0, review = 0;
    const notes: string[] = [];
    for (const evidence of batch) {
      if (Date.now() >= deadline || invocation.signal.aborted) break;
      let text = evidence.textBlob ? t.blobs.readText(evidence.textBlob) ?? "" : "";
      if (evidence.parseStatus === "pending_attachment") {
        const pdfs = evidence.attachments.filter((item) => item.mimeType === "application/pdf" && item.attachmentId).slice(0, 2);
        let blocked: string | null = null;
        for (const pdf of pdfs) {
          try {
            const data = (await invocation.capability("gmail.get_attachment", { messageId: evidence.externalId, attachmentId: pdf.attachmentId }, { binding: "mail", account })) as { data?: string };
            if (!data?.data) continue;
            const base64 = Buffer.from(data.data, "base64url").toString("base64");
            const extracted = (await invocation.capability("extract_text", { fileName: pdf.filename.slice(0, 200), mimeType: "application/pdf", base64 })) as { text?: string };
            if (extracted?.text) text = `${text}\n\nAttachment ${pdf.filename}:\n${extracted.text}`;
          } catch (error) {
            const code = (error as AppError)?.code;
            if (code === "forbidden" || code === "unsupported") { blocked = "Reading attachments is not allowed for Travel. Allow file reading in Sources, or enter the details by hand."; break; }
            if (code === "revoked") throw error;
            blocked = redact(error);
          }
        }
        read++;
        const parse = parseConfirmation({ text, subject: evidence.title, senderName: evidence.sender, receivedAt: evidence.receivedAt });
        transaction(db, () => {
          const textBlob = intake.storeText(text);
          if (parse.bookings.length) {
            repo.updateEvidence(evidence.id, { parseStatus: "parsed", parseMethod: "deterministic", textBlob, parseNote: null });
            const outcomes = intake.applyAll(repo.evidence(evidence.id)!, parse, actor);
            added += outcomes.filter((item) => item.action === "created").length;
            review += outcomes.filter((item) => !!item.reviewId).length;
          } else if (aiEnabled && !blocked) repo.updateEvidence(evidence.id, { parseStatus: "pending_ai", textBlob });
          else {
            repo.updateEvidence(evidence.id, { parseStatus: "unreadable", textBlob, parseNote: blocked ?? "No booking details could be read from the attachment." });
            t.ingest(actor).review({ kind: "unreadable", evidence: repo.evidence(evidence.id)!, reason: blocked ?? "This looks like a travel confirmation, but no booking details could be read from the message or its attachment. Enter the details by hand." });
            review++;
          }
        });
        continue;
      }
      // Opted-in AI fallback with exact passages. Suggestions wait in Review.
      const result = await aiExtract(invocation, text, { subject: evidence.title, receivedAt: evidence.receivedAt });
      read++;
      if (result.status === "unavailable") {
        repo.updateEvidence(evidence.id, { parseNote: result.reason });
        notes.push(result.reason);
        break;
      }
      transaction(db, () => {
        if (result.status === "ok") {
          repo.updateEvidence(evidence.id, { parseStatus: "partial", parseMethod: "ai", parseNote: "AI suggestion waiting in Review" });
          const parse = { bookings: result.bookings, forwarded: evidence.forwarded, travelLike: true, notes: [] };
          review += intake.applyAll(repo.evidence(evidence.id)!, parse, actor).filter((item) => !!item.reviewId).length;
        } else {
          repo.updateEvidence(evidence.id, { parseStatus: "ai_failed", parseNote: result.reason });
          t.ingest(actor).review({ kind: "unreadable", evidence: repo.evidence(evidence.id)!, reason: `${result.reason} Enter the details by hand, or dismiss.` });
          review++;
        }
      });
    }
    const remaining = repo.evidenceByStatus(statuses, [source], 1).length > 0 && !notes.length;
    return { more: remaining, summary: notes[0] ?? `Read ${read} saved source${read === 1 ? "" : "s"}${review ? `, ${review} to review` : ""}${added ? `, added ${added}` : ""}`, read, added, review, skipped: 0, removed: 0 };
  }

  /**
   * Run one bounded step. A schedule passes nothing and works through its
   * automatic accounts fairly. Continue passes one account and kind, with the
   * owner's access.
   */
  async function step(invocation: AppInvocation, options: { only?: { account: string; kind: "mail" | "calendar" }; kinds?: string[] } = {}): Promise<StepSummary> {
    t.resolve(invocation, "write");
    const actor = t.actor(invocation);
    jobs.recover();
    const granted = (invocation.access?.accounts ?? []).filter((item) => kindOfBinding(item.binding) && (!options.only || (item.account === options.only.account && kindOfBinding(item.binding) === options.only.kind)));
    if (options.only && !granted.length) throw new AppError("forbidden", "Grant this account to Travel in Sources first");
    const sources = new Set<string>();
    transaction(db, () => {
      for (const item of granted) {
        const kind = kindOfBinding(item.binding)!;
        const source = accountSource(item.account);
        let stored = accounts.get(item.account, kind);
        if (!stored) stored = accounts.setup({ account: item.account, kind, historyDays: DEFAULT_HISTORY_DAYS, calendars: kind === "calendar" ? ["primary"] : [] });
        const job = jobs.ensure(`${kind}_sync`, source, { idempotent: true });
        if (stored.paused) {
          if (job.state !== "paused") jobs.pause(source);
          continue;
        }
        if (job.state === "paused") jobs.resume(source);
        if (kind === "mail" && repo.evidenceByStatus(t.settings.get().aiExtraction ? ["pending_attachment", "pending_ai"] : ["pending_attachment"], [source], 1).length) jobs.ensure("enrich", source, { idempotent: true });
        if (options.only) {
          // A person asked to continue now: retry a failed step and skip the idle wait.
          const current = jobs.find(`${kind}_sync`, source)!;
          if (current.state === "failed") jobs.resume(source);
          else jobs.wake(current.id);
          const enrich = jobs.find("enrich", source);
          if (enrich && enrich.state === "pending") jobs.wake(enrich.id);
        }
        sources.add(source);
      }
    });
    if (options.only && accounts.get(options.only.account, options.only.kind)?.paused) return idle("Updates are paused for this account. Resume them to continue.");
    const kinds = options.kinds ?? (options.only ? [`${options.only.kind}_sync`, ...(options.only.kind === "mail" ? ["enrich"] : [])] : undefined);
    // The job queue keeps real time, independent of the clock used for trip dates.
    const job = jobs.next(new Date().toISOString(), { sources, kinds });
    if (!job) return idle(granted.length ? "Everything is up to date for now." : "No accounts update automatically.");
    const claimed = jobs.claim(job.id);
    const account = claimed.sourceKey.replace(/^account:/, "");
    try {
      const result = claimed.kind === "mail_sync" ? await mailStep(invocation, account, actor)
        : claimed.kind === "calendar_sync" ? await calendarStep(invocation, account)
        : await enrichStep(invocation, claimed.sourceKey, actor);
      jobs.finish(claimed.id, { more: result.more, idleMs: IDLE_MS });
      return { ran: true, kind: claimed.kind, source: claimed.sourceKey, ...result };
    } catch (error) {
      return failed(claimed, account, error);
    }
  }

  function failed(job: JobRecord, account: string, error: unknown): StepSummary {
    const code = (error as AppError)?.code;
    const kind = job.kind === "calendar_sync" ? "calendar" : "mail";
    const reason = code === "revoked" ? "Reconnect this account in Ri to continue updates. Records already imported are kept."
      : code === "forbidden" ? "Travel no longer has access to this account. Grant it again in Sources."
      : code === "busy" || code === "timeout" ? "The account was busy. Travel will try again shortly."
      : redact(error);
    transaction(db, () => {
      // A revoked account retries with backoff, so updates resume on their own after a reconnect in Ri.
      jobs.fail(job.id, reason, { retryable: code !== "forbidden" });
      if (accounts.get(account, kind)) accounts.failed(account, kind, code === "revoked" || code === "forbidden" ? "reconnect" : "error", reason);
    });
    if (code === "interrupted") throw error;
    return { ran: true, kind: job.kind, source: job.sourceKey, more: false, summary: reason, read: 0, added: 0, review: 0, skipped: 0, removed: 0 };
  }

  return { step, markRemoved, restore, storeEvent, mailStep, calendarStep, enrichStep };
}
export type Sync = ReturnType<typeof createSync>;
export { canonicalText };
