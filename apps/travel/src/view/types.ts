/** View types inferred from the action schemas. Type-only imports keep zod out of the bundle. */
import type { z } from "zod/v4";
import type * as s from "../actions/schemas.js";
import type { BookingDraft } from "../domain/model.js";

export type OpenData = z.infer<typeof s.openViewOutput>["data"];
export type Trip = z.infer<typeof s.tripSchema>;
export type TripDetail = z.infer<typeof s.tripDetailSchema>;
export type Day = TripDetail["days"][number];
export type Item = Day["items"][number];
export type Gap = TripDetail["coverage"]["gaps"][number];
export type CalendarState = TripDetail["calendar"];
export type Booking = z.infer<typeof s.bookingSchema>;
export type BookingDetail = z.infer<typeof s.bookingDetailSchema>;
export type ReviewItem = z.infer<typeof s.reviewItemSchema>;
export type Idea = z.infer<typeof s.ideaSchema>;
export type FollowUp = z.infer<typeof s.followUpSchema>;
export type SourceRef = z.infer<typeof s.sourceRefSchema>;
export type Evidence = z.infer<typeof s.evidenceDetailSchema>;
export type Compare = z.infer<typeof s.compareOutput>;
export type Preview = z.infer<typeof s.previewOutput>;
export type ApplyResult = z.infer<typeof s.applyOutput>;
export type Sources = z.infer<typeof s.listSourcesOutput>;
export type SourceAccountRecord = Sources["accounts"][number];
export type StepResult = z.infer<typeof s.continueOutput>;
export type FollowUpResult = z.infer<typeof s.followUpOutput>;
export type Write<T> = { status: "saved"; record: T } | { status: "conflict"; current: T; message: string };
export type ReviewWrite = { status: "saved"; record: ReviewItem; bookingId: string | null; tripId: string | null; message: string } | { status: "conflict"; current: ReviewItem; message: string };
export type List<T> = { items: T[]; nextCursor: string | null; coverage: { complete: boolean; note: string | null }; revision: string };
export type { BookingDraft };

export type TripTab = "itinerary" | "bookings" | "ideas";
export type StatusFilter = "all" | "confirmed" | "planned" | "canceled" | "needs_review";
export type Route =
  | { section: "trips" }
  | { section: "trip"; tripId: string; tab: TripTab; day: string | null; selected: string | null; status: StatusFilter; q: string }
  | { section: "review"; tripId: string | null }
  | { section: "sources" }
  | { section: "access" };
