---
name: review-follow-ups
description: Review what the user owes people, what they are waiting on and the suggested commitments in this app, and help them choose follow-ups. Use when they ask what they promised someone, what is outstanding, or to turn a commitment into a task.
---

# Review follow-ups

1. Read `list_commitments` with `filter` set to `i_owe`, `waiting_on` or `suggestions`, optionally for one `personId` or `organizationId`.
2. Summarize each item with who owes whom, the action, any stated due date and its evidence. Keep suggestions clearly separate from accepted commitments.
3. Only when the user asks, accept or dismiss a suggestion with `review_commitment` (it needs the item's `revision`), or create one Ri task with `create_follow_up`. Show the task title and date first.

Rules:
- Never invent a deadline. A due date exists only when the source states one.
- A later reply is not proof something was done. Completion evidence only suggests completion. The user decides.
- Ri owns task status. Never recreate a task that Ri reports as unavailable.
- Never send anything to anyone.
