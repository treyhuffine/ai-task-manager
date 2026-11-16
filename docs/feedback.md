# Feedback and bugs

All feedback, bug reports and questions go to public GitHub issues in `dynamismlabs/ri`. There is one flow: describe the feedback in Ri, continue to GitHub, review the issue draft, then publish it there. Ri requires no feedback receiver, webhook, or separate private inbox.

The interface names GitHub and public visibility before the person continues. The action says **Continue on GitHub**. After opening the issue composer, Ri says **Finish on GitHub** and explains that the person must publish there. Opening a composer is never treated as a created issue. GitHub handles sign-in, publication and subsequent discussion.

## Drafts and files

The wide rail, collapsed rail, command palette and phone More menu share the same draft for the authenticated Home and person. Text, selected upload metadata and the prepared GitHub URL are kept in this browser's local storage. Closing, switching entry points or reloading keeps the draft. Team keys include both Home and member IDs. Editing a draft invalidates its prepared GitHub URL. **Start new feedback** clears it deliberately.

Screenshots can be pasted or dropped into Ri. Up to five files are allowed, 10 MiB each and 20 MiB total. Uploads use the existing attachment system and its Home boundaries. Rapid pastes cannot bypass the limit, and successful files survive a partial upload failure. Files are not automatically uploaded to GitHub. The interface explains this and provides a download action for each file so the person can add it on GitHub before publishing. No authenticated Home file URL is placed in the public issue body.

The textarea and surrounding surfaces are height constrained. The phone dialog uses the shared visual viewport hook to keep its footer above the on-screen keyboard. Categories use native radio controls. Closing restores keyboard focus to the invoking control.

## Preparation and privacy

`feedback.preparePublicIssue` is an authenticated shared procedure. A Personal Home's viewer or an active Team member can call it. In a Team document inside My Ri, preparation and attachment uploads use the existing Team relay. Preparing an issue creates a prefilled GitHub URL and the complete Markdown report. It never publishes, forwards, or creates a server-side feedback receipt. For long reports, the full text can be copied or downloaded from the handoff. Reports too large for a bounded prefilled URL remain intact and prompt the person to paste the full report into GitHub.

When app info is unchecked, the issue contains no app diagnostics section. When checked, the report may contain Ri version/build, server platform/architecture, view kind, viewport tier, theme, desktop/web surface, Home kind and browser user agent. No URL, task or note body, chat transcript, Home ID or member ID is included automatically. The person's message and files are their explicit report content.

A preparation or popup failure keeps the draft and offers the same GitHub path again. There is no delivery success screen, private receiver configuration, automatic retry or background forwarding.

## Verification

`pnpm test src/lib/feedback/submit.test.ts src/lib/feedback/router.test.ts src/components/feedback/feedback-draft.test.ts src/components/feedback/feedback.browser.test.ts src/components/workspaces/rail-footer.browser.test.ts src/lib/process-state.test.ts`

Tests cover issue labels and privacy, long reports, draft restoration and Home/member isolation, keyboard/focus, file limits and partial failures, small screens, preparation errors, and actual Personal/Team route admission and Team uploads. Browser tests use a synthetic issue composer and never publish feedback.

Set `RI_FEEDBACK_SCREENSHOTS=/absolute/output/folder` when running `feedback.browser.test.ts` to capture the desktop compose view, phone attachment view, GitHub handoff, preparation error and reduced-height phone view. These are actual components with synthetic reports.
