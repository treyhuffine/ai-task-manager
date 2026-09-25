/** The text a harness receives on a fresh chat whose brief could not go in the instructions file. */
export function withFirstTurnPreamble(message: string, preamble: string | null): string {
  if (!preamble) return message;
  return [
    "[Session instructions for this chat, from the app. The user did not type this, and won't see it.]",
    preamble,
    "[The user's first message follows.]",
    message,
  ].join('\n\n');
}
