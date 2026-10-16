/**
 * Linked Ri follow-ups. The link row and its operation ID are stored first,
 * then Ri's create_task runs with that operation ID, so a retry or a second
 * click returns the same task. Availability is checked with get_task.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { AppError } from "@ri/app-kit/contract";
import { allows, allowsAll, redact, transaction, type AccessScope } from "@ri/app-kit/data";
import type { AppInvocation } from "@ri/app-kit/sdk";
import { formatDateRange } from "@ri/app-kit/time";
import type { createFollowUpInput } from "../actions/schemas.js";
import type { FollowUpRow } from "../db/repo.js";
import type { Travel } from "./core.js";
import { createReadModel } from "./records.js";
import { reviewVisible } from "./ingest.js";

type CreateInput = z.infer<typeof createFollowUpInput>;
const taskSchema = z.object({ id: z.string().min(1).max(128) }).passthrough();

export function createFollowUps(t: Travel) {
  const { repo } = t;
  const read = createReadModel(t);

  /** The subject under the caller's scope, with its source key and a plain description. */
  function subject(scope: AccessScope, input: CreateInput["subject"]): { sourceKey: string; label: string } {
    if (input.type === "trip") {
      const trip = repo.trip(input.id);
      if (!trip || !read.visibleTrip(scope, trip).visible) throw new AppError("not_found", "That trip is no longer available");
      const record = read.tripRecord(scope, trip);
      return { sourceKey: allows(scope, trip.sourceKey) ? trip.sourceKey : repo.bookings(scope, { tripId: trip.id })[0]?.sourceKey ?? trip.sourceKey, label: `${record.title}${record.startDate && record.endDate ? `, ${formatDateRange(record.startDate, record.endDate)}` : ""}` };
    }
    if (input.type === "booking") {
      const booking = repo.booking(input.id);
      if (!booking || !allowsAll(scope, booking.sourceKeys)) throw new AppError("not_found", "That booking is no longer available");
      return { sourceKey: booking.sourceKey, label: `${booking.title}${booking.reference ? `, confirmation ${booking.reference}` : ""}` };
    }
    if (input.type === "idea") {
      const idea = repo.idea(input.id);
      if (!idea || !allows(scope, idea.sourceKey)) throw new AppError("not_found", "That idea is no longer available");
      return { sourceKey: idea.sourceKey, label: `Idea: ${idea.title}` };
    }
    const item = repo.review(input.id);
    if (!item || !reviewVisible(scope, item, repo)) throw new AppError("not_found", "That review item is no longer available");
    return { sourceKey: item.sourceKey, label: `Review item: ${item.reason.slice(0, 120)}` };
  }

  async function create(invocation: AppInvocation, scope: AccessScope, input: CreateInput) {
    const about = subject(scope, input.subject);
    const actor = t.actor(invocation);
    // The link and its operation ID exist before Ri is asked, and a retry of this invocation returns the same link.
    const link = t.store.mutate(invocation, "create_follow_up", input, () => {
      const operationId = input.operationId ?? randomUUID();
      const existing = repo.followUpByOperation(operationId);
      if (existing) {
        if (existing.subjectId !== input.subject.id) throw new AppError("conflict", "This follow-up belongs to another record");
        return { id: existing.id };
      }
      return { id: repo.insertFollowUp({ subjectType: input.subject.type, subjectId: input.subject.id, operationId, title: input.title, dueAt: input.dueAt ?? null, sourceKey: about.sourceKey, actor }).id };
    });
    const row = repo.followUp(link.id)!;
    if (row.taskId) return { status: "created" as const, followUp: read.followUpRecord(row), message: "This follow-up already has its Ri task." };
    try {
      const task = taskSchema.parse(await invocation.capability("create_task", {
        title: row.title,
        description: `From Travel: ${about.label}`.slice(0, 4000),
        ...(input.description ? { body: input.description.slice(0, 64000) } : {}),
        ...(row.dueAt ? { dueAt: row.dueAt } : {}),
        operationId: row.operationId,
      }));
      transaction(t.db, () => repo.updateFollowUp(row.id, { taskId: task.id, state: "created", availability: "available", checkedAt: repo.iso(), lastError: null }));
      return { status: "created" as const, followUp: read.followUpRecord(repo.followUp(row.id)!), message: "Created one Ri task linked to this record." };
    } catch (error) {
      const code = (error as AppError)?.code;
      const state: FollowUpRow["state"] = code === "forbidden" ? "needs_permission" : code === "approval_required" || code === "busy" || code === "timeout" ? "pending" : "failed";
      const message = state === "needs_permission" ? "Travel is not allowed to create Ri tasks yet. Allow it in Sources, then try again." : state === "pending" ? "Ri has not created the task yet. Try again shortly. The same task will be used." : code === "unsupported" ? "Ri tasks are not available here." : redact(error);
      transaction(t.db, () => repo.updateFollowUp(row.id, { state, lastError: message }));
      return { status: state === "needs_permission" ? "needs_permission" as const : state === "pending" ? "pending" as const : "failed" as const, followUp: read.followUpRecord(repo.followUp(row.id)!), message };
    }
  }

  async function check(invocation: AppInvocation, scope: AccessScope, id: string) {
    const row = repo.followUp(id);
    if (!row || !allows(scope, row.sourceKey)) throw new AppError("not_found", "That follow-up is no longer available");
    if (!row.taskId) return read.followUpRecord(row);
    let availability: FollowUpRow["availability"] = "unknown";
    try {
      taskSchema.parse(await invocation.capability("get_task", { id: row.taskId }));
      availability = "available";
    } catch (error) {
      const code = (error as AppError)?.code;
      if (code === "not_found") availability = "missing";
      else if (code !== "forbidden" && code !== "unsupported") throw error;
    }
    transaction(t.db, () => repo.updateFollowUp(row.id, { availability, checkedAt: repo.iso() }));
    return read.followUpRecord(repo.followUp(row.id)!);
  }

  function list(scope: AccessScope, subjectId?: string) {
    return repo.followUps({ subjectId, sourceKeys: scope.kind === "owner" ? null : [...scope.sources] }).map(read.followUpRecord);
  }

  return { create, check, list };
}
