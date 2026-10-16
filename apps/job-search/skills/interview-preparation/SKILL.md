---
name: interview-preparation
description: Prepare someone for an upcoming job interview with this app's records. Use when they ask to prepare for an interview, practice answers, or review a role before a conversation.
---

# Interview preparation with Job Search

1. Find the interview. Use `get_today` or `list_interviews` with `upcoming: true`, or the interview already in the chat's context. Read its time in its own time zone, its format, participants and status. A status of `scheduling_needed` means no time is confirmed yet. Say so instead of guessing a time.
2. Read the role with `get_opportunity`: the posting snapshot's stated requirements, the submissions with their exact material versions, and the linked correspondence. If there is no posting snapshot, tell the person to add the description in the app so preparation can quote it.
3. Read `get_preparation` for the interview. The examples, questions and notes are the person's own words and facts. AI suggestions are listed separately and are not facts about the person.
4. Help them prepare from that evidence only. Quote requirements as written. Suggest how to present experience their submitted materials or examples already state. Never invent employers, titles, achievements, numbers, degrees or credentials. When a requirement has no supporting example, name the gap and ask them about it.
5. If they want to keep something, save it with `save_preparation`, passing the revision you read. On a conflict, show the current values and ask before saving again.
6. Never send email, accept invitations or contact anyone. Draft text for them to edit and send themselves.
