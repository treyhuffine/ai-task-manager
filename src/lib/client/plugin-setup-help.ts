/** Retry the same setup request with the same message ID after an uncertain send. */
export interface PluginSetupHelpRequest {
  eventId: string;
  content: string;
  sessionId?: string;
}

export async function sendPluginSetupHelp(request: PluginSetupHelpRequest, deps: {
  ensureMainChat: () => Promise<{ session: { id: string } }>;
  sendMessage: (sessionId: string, content: string, opts: { eventId: string }) => Promise<unknown>;
}) {
  if (!request.sessionId) request.sessionId = (await deps.ensureMainChat()).session.id;
  await deps.sendMessage(request.sessionId, request.content, { eventId: request.eventId });
  return request.sessionId;
}
