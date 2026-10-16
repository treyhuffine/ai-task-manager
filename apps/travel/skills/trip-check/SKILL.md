---
name: trip-check
description: Check a trip in this app for what is missing or conflicting, using only its recorded bookings, coverage checks and calendar events. Use when someone asks what is missing, whether nights are covered, or how a day fits together.
---

# Trip check

Use this app's records only. Do not guess bookings that are not recorded.

1. Read the trip with `get_trip`. Its itinerary lists entries by local date, with each place's own time zone.
2. Report coverage from `coverage.gaps`:
   - A night gap says "No booking recorded for the night of ...". Present it as something to check, since staying with friends or an overnight journey can be intentional.
   - An overlap names the two bookings and their local times.
   - A time without a zone cannot be compared precisely. Say so instead of guessing.
3. Mention open items from `review` that affect the trip, such as a changed check-in time. Do not decide them. The owner decides in Review.
4. Mention calendar events that fall during the trip from `calendar.events`. An event that matches a booking is not a conflict.
5. Keep ideas separate. Ideas are never confirmed bookings, and prices in different currencies are never added together.
6. Offer a follow-up with `create_follow_up` only when asked. It creates one Ri task and sends nothing.

Quote dates as "November 9 to 14", times with their zone label, and cite the booking or source you relied on.
