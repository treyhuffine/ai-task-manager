/**
 * Source intake. A message, file or pasted text becomes one evidence record
 * with its digest, retained text and parse outcome, then each parsed booking
 * goes through ingestion. Mail that is not travel related is never stored.
 */
import { accountSource, boundText, sha256 } from "@ri/app-kit/data";
import { emailDomain, type MailMessage } from "@ri/app-kit/sources";
import { IMPORTS_SOURCE, type ParseResult } from "../domain/model.js";
import { isComplete, parseConfirmation, PARSE_VERSION, type ParseInvite } from "../domain/parse/extract.js";
import type { EvidenceRow } from "../db/repo.js";
import type { Travel } from "./core.js";
import type { Outcome } from "./ingest.js";

const TRAVEL_ATTACHMENT = /(itinerar|e-?ticket|ticket|booking|confirm|reservation|receipt|voucher|boarding)/i;
export const TEXT_LIMIT = 64_000;

export function canonicalText(subject: string | null, body: string): string {
  const text = body.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  return subject ? `Subject: ${subject}\n\n${text}` : text;
}
function excerptOf(parse: ParseResult, text: string): string {
  const passages = [...new Set(parse.bookings.flatMap((booking) => booking.passages))];
  const joined = passages.join("\n");
  return boundText(joined || text, 1200).text;
}
function inviteOf(message: Pick<MailMessage, "invite">): ParseInvite | null {
  const invite = message.invite;
  return invite ? { method: invite.method, uid: invite.uid, summary: invite.summary, start: invite.start, end: invite.end, status: invite.status, sequence: invite.sequence } : null;
}

export interface IntakeResult { evidence: EvidenceRow | null; outcomes: Outcome[]; kept: boolean; reason: string }

export function createIntake(t: Travel) {
  const { repo, blobs } = t;

  function storeText(text: string) {
    return blobs.put(boundText(text, TEXT_LIMIT).text).digest;
  }

  /** Apply every parsed booking from one evidence record. */
  function applyAll(evidence: EvidenceRow, parse: ParseResult, actor: string, options: { fictional?: boolean } = {}): Outcome[] {
    const ingest = t.ingest(actor);
    return parse.bookings.map((booking) => ingest.apply(evidence, booking, { fictional: options.fictional }));
  }

  /**
   * One Gmail message. Kept only when it reads as travel: parsed bookings, a
   * likely booking attachment to read later, or travel text for the opted-in
   * AI fallback. Everything else is recorded as skipped without its body.
   */
  function mailMessage(account: string, message: MailMessage, actor: string): IntakeResult {
    if (message.discarded || message.draft || message.sent) return { evidence: null, outcomes: [], kept: false, reason: "Not inbox mail" };
    const sourceKey = accountSource(account);
    const existing = repo.evidenceByExternal(sourceKey, message.id);
    if (existing) return { evidence: existing, outcomes: [], kept: true, reason: "Already recorded" };
    const text = canonicalText(message.subject, message.text);
    const parse = parseConfirmation({ text, subject: message.subject, senderName: message.from?.name ?? null, senderAddress: message.from?.address ?? null, receivedAt: message.receivedAt, invite: inviteOf(message) });
    const pdfs = message.attachments.filter((item) => item.mimeType === "application/pdf" && item.attachmentId && item.size <= 512 * 1024 && (TRAVEL_ATTACHMENT.test(item.filename) || parse.travelLike));
    const aiEnabled = t.settings.get().aiExtraction;
    let status: EvidenceRow["parseStatus"];
    if (parse.bookings.length) status = parse.bookings.some((booking) => booking.missing.some((field) => !["reference", "travelers"].includes(field)) || booking.ambiguous.length) ? "partial" : "parsed";
    else if (pdfs.length) status = "pending_attachment";
    else if (parse.travelLike && aiEnabled) status = "pending_ai";
    else if (parse.travelLike && /\b(confirmation|booking|reservation|itinerary|e-?ticket)\b/i.test(message.subject) && /\d/.test(message.subject + message.text.slice(0, 2000))) status = "unreadable";
    else return { evidence: null, outcomes: [], kept: false, reason: "Not a travel confirmation" };
    const evidence = repo.insertEvidence({
      sourceKey, origin: "gmail", account, externalId: message.id, threadId: message.threadId, messageIdHeader: message.messageId,
      inviteUid: message.invite?.uid ?? null, inviteSequence: message.invite?.sequence ?? null,
      title: message.subject || "(no subject)", sender: message.from?.name ?? message.from?.address ?? null, senderDomain: message.from ? emailDomain(message.from.address) : null,
      receivedAt: message.receivedAt, observedAt: repo.iso(), digest: message.digest, textBlob: storeText(text), fileBlob: null, fileName: null, mimeType: "message/rfc822",
      excerpt: excerptOf(parse, text), parseVersion: PARSE_VERSION, parseStatus: status, parseMethod: parse.bookings.length ? "deterministic" : null,
      parseNote: parse.notes[0] ?? null, attachments: message.attachments.slice(0, 20).map((item) => ({ attachmentId: item.attachmentId, filename: item.filename, mimeType: item.mimeType, size: item.size })),
      forwarded: parse.forwarded, fictional: false,
    });
    const outcomes = applyAll(evidence, parse, actor);
    if (status === "unreadable") t.ingest(actor).review({ kind: "unreadable", evidence, reason: "This looks like a travel confirmation, but no booking details could be read. Open the source and enter the details by hand." });
    return { evidence, outcomes, kept: true, reason: outcomes.map((outcome) => outcome.message).join(" ") || "Kept for later reading" };
  }

  /** A file or pasted text the person chose. Stored once per content digest in the imports collection. */
  function imported(input: { kind: "file" | "paste"; text: string; fileName: string | null; mimeType: string | null; bytes: Buffer | null; subject?: string | null; sender?: { name: string | null; address: string | null } | null; receivedAt?: string | null; invite?: ParseInvite | null }, parse: ParseResult, fictional = false): EvidenceRow {
    const sourceDigest = sha256(input.bytes ?? Buffer.from(input.text, "utf8"));
    const existing = repo.evidenceByDigest(IMPORTS_SOURCE, sourceDigest);
    if (existing) return existing;
    const firstLine = input.text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
    return repo.insertEvidence({
      sourceKey: IMPORTS_SOURCE, origin: input.kind, account: null, externalId: null, threadId: null, messageIdHeader: null,
      inviteUid: input.invite?.uid ?? null, inviteSequence: input.invite?.sequence ?? null,
      title: input.kind === "file" ? input.fileName ?? "Uploaded file" : input.subject || `Pasted: ${firstLine.slice(0, 80) || "confirmation"}`,
      sender: input.sender?.name ?? input.sender?.address ?? null, senderDomain: input.sender?.address ? emailDomain(input.sender.address) : null,
      receivedAt: input.receivedAt ?? null, observedAt: repo.iso(), digest: sourceDigest, textBlob: storeText(input.text), fileBlob: input.bytes ? blobs.put(input.bytes).digest : null,
      fileName: input.fileName, mimeType: input.mimeType, excerpt: excerptOf(parse, input.text), parseVersion: PARSE_VERSION,
      parseStatus: !parse.bookings.length ? "unreadable" : parse.bookings.every((booking) => isComplete(booking) && !booking.ambiguous.length) ? "parsed" : "partial",
      parseMethod: parse.bookings.length ? parse.bookings[0].method : null, parseNote: parse.notes[0] ?? null,
      attachments: [], forwarded: parse.forwarded, fictional,
    });
  }

  /** A fictional fixture message: same parser and ingestion, its own source key. */
  function fixtureMessage(sourceKey: string, account: string, message: { id: string; subject: string; from: string; receivedAt: string; text: string }, actor: string): IntakeResult {
    const [, name, address] = /^(.*?)\s*<([^>]+)>$/.exec(message.from) ?? [null, null, message.from];
    const text = canonicalText(message.subject, message.text);
    const parse = parseConfirmation({ text, subject: message.subject, senderName: name, senderAddress: address, receivedAt: message.receivedAt });
    const evidence = repo.insertEvidence({
      sourceKey, origin: "fixture", account, externalId: message.id, threadId: message.id, messageIdHeader: null, inviteUid: null, inviteSequence: null,
      title: message.subject, sender: name ?? address, senderDomain: address ? emailDomain(address) : null, receivedAt: message.receivedAt, observedAt: message.receivedAt,
      digest: sha256(text), textBlob: storeText(text), fileBlob: null, fileName: null, mimeType: "message/rfc822", excerpt: excerptOf(parse, text), parseVersion: PARSE_VERSION,
      parseStatus: parse.bookings.length ? "parsed" : "unreadable", parseMethod: "deterministic", parseNote: null, attachments: [], forwarded: parse.forwarded, fictional: true,
    });
    return { evidence, outcomes: applyAll(evidence, parse, actor, { fictional: true }), kept: true, reason: "Fictional example" };
  }

  return { mailMessage, imported, applyAll, fixtureMessage, storeText };
}
export type Intake = ReturnType<typeof createIntake>;
