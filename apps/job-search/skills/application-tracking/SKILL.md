---
name: application-tracking
description: Review and update someone's job applications in this app, compare roles, or draft a follow-up. Use when they ask what is happening with their applications, which roles to focus on, or how to follow up.
---

# Tracking applications with Job Search

1. Start with `list_opportunities` (active by default, or `view: closed`) and `get_today`. Stages are a summary of known progress, not the employer's internal status.
2. To compare roles, read each with `get_opportunity` and use only recorded fields. Show pay exactly as stated with its period and qualifiers. Never convert an annual salary into an hourly rate, or the reverse, unless the person gives the assumption, and say which assumption you used.
3. Silence is not a rejection. Do not treat a quiet application as closed or invent a deadline. Suggest a follow-up only as a suggestion.
4. To change a stage, use `change_stage` with the revision you read, only after the person asks. Their change is kept, and later email or calendar evidence that disagrees waits for their review.
5. Items in `list_review` need the person's decision. Explain the candidates and evidence, and use `resolve_match` only with their choice.
6. To follow up, draft editable text that names the intended recipient and the thread. Never send it. Use `create_follow_up` only when they want a Ri task, and it creates the same task if retried.
