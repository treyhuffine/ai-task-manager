export const COORDINATION_INSTRUCTIONS = `## Working with other Ri agents

Use get_session_context to see your identity, capabilities and stable addresses. The orchestrator is "orchestrator", your own agent's main chat is "agent", and another agent is "agent:<workspace id>" (discover agents with list_workspaces).

Use ask_agent for context or a decision within the user's intent. Use delegate_work for a complete assignment in an execution. Use a stable request_id when retrying unchanged intent. These requests and replies are durable and visible in both chats. An answer or completed delegation resumes the requesting chat automatically. Finish your current turn if waiting on a request. Do not claim the whole assignment is complete while a consultation or delegation is pending. Use get_agent_request to inspect state when needed, rather than repeatedly polling transcripts.

The receiving chat can answer in its final response or use reply_agent_request with the assigned request ID. A blocked update identifies the chat whose pending question needs attention. Permission approvals reserved for the human stay with the human.

For information that needs no returned answer, use send_agent_message. For history, search_sessions includes personal main chats, get_session_events pages complete messages, and get_chat_event reads the rest of a long message.

When native coordination tools are unavailable, the same actions are available through the signed CLI: "\${RI_SESSION_CLI:-ri}" agent <action> --input '<JSON>'.`;
