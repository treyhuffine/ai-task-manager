# Slack conversations with Ri

**Status:** Draft proposal for discussion, not approved for implementation.
**Date:** 2026-10-15

Slack could become another place to talk with a personal Ri orchestrator or a team's AI. The value is continuity: ask for something where the discussion is happening, answer Ri's questions, change direction, and receive the result without moving the conversation between tools.

The recommended foundation is an ordinary Ri conversation served through Slack's native agent interface. Ri owns its conversation state and actions. Slack provides another place to participate. The main product decisions are which Ri instance answers, who can see the conversation, and when Ri should participate.

Existing AI-generated design notes are background material. They do not establish approval for these choices. The recommendations below need to be evaluated on their own merits.

## The intended experience

The user has asked for an ongoing two-way conversation, including the possibility of connecting to a team instance. Personal and team connections are both relevant. Starting with a team pilot is a recommendation in this proposal.

A useful team interaction could look like this:

> **Maya:** @Ri capture the decision from this discussion.
>
> **Ri:** Is the decision to redirect expired sessions to login while preserving the destination?
>
> **Jon:** Yes, and show a message explaining that the session expired.
>
> **Ri:** Maya, should I include that in the decision?
>
> **Maya:** Yes. Link it to the login task too.
>
> **Ri:** Saved the decision and linked the task. Here are both records.

Ri should retain that conversation, recognize the people speaking, and make its resulting work accessible in the app. People should also be able to continue the conversation from Ri, with relevant replies delivered back to the Slack thread.

Two-way communication includes Ri returning with a question or update after accepting work. Delivering such an update is separate from granting the team AI new capabilities such as recurring autonomous work or coding executions.

## Separate ownership audience and entry point

These concepts answer different questions:

| Concept | Question it answers |
| --- | --- |
| Ri instance | Which data, tools, AI identity, and model configuration serve this conversation? |
| Conversation | What has been said, who is participating, and what work is underway? |
| Audience | Who may read the conversation and receive its contents? |
| Requesting person | Whose authority applies to the current request and its actions? |
| Entry point | Is someone participating through Slack or through Ri? |

A connection should name its destination explicitly. A team channel connected to Acme's Ri addresses Acme's AI consistently. A personal connection addresses that person's orchestrator. Routing should not silently switch between the team and personal homes according to who last spoke.

A team-owned AI can have a private conversation with one member. Team ownership determines its capabilities, while the conversation's audience determines who can read it. Treating those as the same thing would make private Slack messages unexpectedly visible to colleagues.

The requesting person can also change within a shared conversation. Maya and Jon can participate in the same thread, with each accepted request attributed to the person who made it. Installing the Slack app does not make every request an action by the installer.

## Use the native Slack agent experience

Slack supports a native agent interface with a side panel, suggested prompts, and threaded conversations. New apps use `agent_view`. Ri would provide the reasoning and tools behind that interface. [Slack agent development](https://docs.slack.dev/ai/developing-agents/), [Agent messaging experience](https://docs.slack.dev/changelog/2026/06/30/agent-messages-tab/)

Slack agent sessions provide working, ready, waiting-for-input, and closed states, together with streaming and a native stop control. Ri needs to translate those controls into actual runtime behavior and keep the displayed state consistent with the work. [Slack agent sessions](https://docs.slack.dev/ai/agent-sessions/)

Native agent presentation and event delivery are separate choices. Socket Mode is a reasonable candidate for a self-hosted pilot because it uses an outbound connection without a public inbound webhook. Connection recovery still matters, and Slack currently excludes Socket Mode apps from the public Marketplace. A distributed product needs its installation and delivery design evaluated separately. [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)

Ri's existing Slack Connector supplies tools for accessing Slack. A conversational entry point additionally needs inbound events, bot authorization, identity linking, and reply delivery. These can appear together in setup without assuming that tool access already supplies conversation routing.

## Let people converse naturally

In a DM, messages ordinarily address Ri. A shared thread also contains people talking to each other, so receiving a message cannot automatically mean accepting a new instruction.

The proposed behavior is:

- A mention brings Ri into a channel thread.
- People can answer Ri's questions and give clearly addressed follow-ups without repeating the mention every time.
- Other discussion can provide context without requiring Ri to answer each message.
- Ri returns with questions, blockers, and results relevant to work it accepted.
- Requests and actions remain attributed to an authorized person, including after a reconnect or delayed reply.

The exact rule for recognizing an untagged follow-up needs to be made concrete in the pilot. It should support natural conversation while allowing Ri to stay quiet during human discussion. A question directed to one person also needs a rule for accepting another participant's answer.

Answers to a runtime question must reach the mechanism that is waiting for them. A runtime blocked on pending input may need that input resolved rather than another ordinary message appended to its queue. Slack's stop control likewise needs to stop the corresponding authorized work and report the outcome.

## Store the conversation in Ri

Reuse `chat_sessions` and `chat_events` for the logical conversation. A Slack thread is a useful default boundary for a Ri chat. The behavior of top-level messages in an agent DM needs an explicit conversation-boundary decision before DM support ships.

Keep Slack transport details in associated binding and delivery records:

- The Slack installation, workspace, channel, and thread linked to the Ri chat.
- Verified Slack identities linked to Ri people or members.
- Source message and event identifiers for attribution, edits, deletions, and deduplication.
- Delivery state for assistant replies, conversation updates, and reconnect recovery.

Keep the harness session identity separate from the Slack conversation identity. They have different lifetimes and purposes.

Ri should preserve accepted human input, AI responses, and the resulting actions. Nearby Slack messages can be retrieved as context with their origin recorded. Importing an entire channel is unnecessary for this model. Editing or deleting a Slack message needs a defined history policy and must not silently repeat an action already taken.

When someone continues from Ri, the app should show that the conversation is connected to Slack and who can see it. Human messages relayed to Slack need clear authorship, such as a bot-delivered message labeled with the Ri sender. Runtime records and internal tool details need their own visibility treatment rather than automatic publication into Slack.

Accept input durably before starting model work. Use stable identifiers to deduplicate delivery, and acknowledge Slack independently of model completion. Outbound delivery failures should retry delivery without rerunning the AI's actions. Recovery after uncertain execution should preserve an interrupted state rather than assume it is safe to repeat the work.

## Resolve visibility before connecting private conversations

Current team chats are readable by every team member. Forwarding a private Slack conversation into that history would widen its audience. The same problem can occur with a restricted channel or with Ri replies posted into a Slack channel containing people outside the Ri team.

The recommended product behavior is:

| Conversation | Proposed audience |
| --- | --- |
| Personal DM with personal Ri | The personal owner |
| DM with a team's AI | That member within the product, served by the team's AI |
| Channel explicitly connected as shared team conversation | The declared shared audience in Slack and Ri |
| Restricted Slack channel | An explicitly authorized equivalent audience in Ri |

Private team DMs require chat authorization that the current all-member team model does not provide. This concerns visibility between members. It does not promise confidentiality from operators of the team's host or determine a future retention policy.

For the proposed pilot, use a channel intended for the whole Ri team and disclose that the resulting chat is team-visible. Private DMs and restricted channels should enter the pilot only if their audience rules are implemented. Publishing a private conversation's outcome as a shared task, note, or decision should be an explicit requested action.

Audience checks apply to reading, history search, links, streams, and outbound delivery as well as sending a message. Mapping a Slack sender to an active member establishes who is asking. It does not by itself authorize everyone in the destination channel to receive team information.

## Reuse the existing team runtime

The current implementation provides useful mechanisms independently of the unapproved product notes:

- The retained team create-chat protocol now calls [`startNewMainChat`](../src/lib/sessions/main-chat.ts) on an owner-enabled team agent. It retains the `team_chat` surface and the ordinary orchestration lifecycle. Existing restricted conversations convert in place through `team/ai/cutover.ts`.
- [`sendToTeamAi`](../src/lib/team/ai/chat.ts) accepts member-attributed, deduplicated sends and runs queued turns in order within each chat.
- [Team turn credentials](../src/lib/team/ai/turn-credential.ts) bind actions to the requesting member and running turn.
- The [team runtime](../src/lib/team/ai/runtime.ts) restricts capabilities to the team's shared-work tools.

A Slack adapter should enter through these shared domain operations so the same authorship, queue, and access rules apply. Keep the team-chat classification and associate a Slack binding with it. Slack is the entry point, while team chat determines the runtime and authorization.

The existing team AI can work with shared tasks, notes, decisions, and published results. Connecting Slack does not establish team repository access, coding environments, personal-agent dispatch, or recurring automation. Those capabilities need their own product and execution contracts if wanted.

## Proposed pilot and decisions

Start with one team instance, one Slack workspace, one explicitly shared channel, and two mapped members. Each thread that invokes Ri gets a team chat. Support clarification, follow-ups, shared-record changes, native work status and stop, and continuation from either Slack or Ri.

The decisions to settle before implementation are:

1. **Destination:** begin with the team's AI, a personal orchestrator, or both? The recommendation is a team pilot.
2. **Audience:** approve the pilot's explicit all-team visibility and determine the policy for private team conversations.
3. **Participation:** define how Ri recognizes follow-ups, handles another member answering its question, and stays quiet during unrelated discussion.
4. **Delivery:** choose a user-created internal Slack app or a shared installable app. Socket Mode is a candidate for the former.
5. **Continuation:** confirm which human messages and AI outputs appear across both interfaces, with authorship and audience visible.

After those decisions, write a bounded implementation spec and build the complete conversational loop using the existing team runtime. The first success case is Maya and Jon recording a decision together, resolving Ri's clarification, and continuing the same conversation in Ri.

Verify the experience and its failure cases together:

- Both members retain their own identities and action attribution.
- A follow-up continues the intended chat, including after reconnecting.
- Replies from Ri arrive in the originating Slack conversation without echo loops.
- Duplicate Slack events and delivery retries produce one accepted request and one set of actions.
- A failed Slack reply can be delivered later without repeating the work.
- Stop, restart, disabled AI, and member removal leave truthful state and enforce the applicable access rules.
- Ordinary human discussion does not automatically become another AI request.
- Conversation content reaches only its declared audience.

The pilot should answer whether this removes context switching and preserves useful work in practice. Use that evidence to choose the next conversation mode and distribution path while keeping ownership, audience, and delivery explicit.
