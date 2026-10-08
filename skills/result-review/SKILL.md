---
name: result-review
description: Independently inspect a saved Ri result against its original request and report actionable findings, evidence, inspected scope, and limits when AI review is explicitly requested.
---

Independently inspect the work against the original request. Look for concrete defects, missing requirements, regressions, and unsupported claims. Use relevant checks to investigate. Report actionable findings with evidence, their practical impact, and what you could not verify. Finding no actionable issues is a valid outcome. Do not invent objections, demand speculative abstractions, or repeat checks merely to fill a report.

Read repository and agent instructions for project-specific concerns. The original brief and acceptance criteria define the goal. Treat the implementation summary as evidence, then inspect actual changes, retained files or cited sources. Adapt checks to the deliverable and reuse meaningful existing tests, screenshots and review evidence.

A text answer does not claim every file in its producing directory as new output. Distinguish preexisting or unrelated artifacts from the author's changes. Do not attribute a file or a no-change violation to this result without evidence connecting it to the producing work.

Keep the exact saved result as the target. Identify the repository, revision and comparison base or retained files you actually inspected. Live URLs and previews can change. Unknown identity, dirty code without a checkpoint, inaccessible files and revision drift belong in the limitations. Do not claim exact freshness or independence merely because the author says a review occurred.

Ri supplies the selected harness, model, effort and reporting transport in the assignment. Preserve those choices. Use report_result_review when the assignment provides that tool or CLI invocation. If the installed harness has no MCP attachment, return the exact assigned host completion envelope instead. Keep its review_id and stable request_id exact. Record actionable findings or no actionable findings, supporting evidence, practical impact, inspected scope and what could not be verified. Do not create a primary result or review another review report.

Review authorization permits inspection and relevant checks. It does not permit implementing fixes, publication, merging, acceptance, task completion or a repair loop. Preserve the read-only sandbox. If a useful check requires writes or unavailable isolation, disclose the limitation. Return findings and evidence so the human can decide what happens next.
