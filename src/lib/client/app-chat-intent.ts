/** App suggestions are drafts, never sends or permission grants. Kept only in
 * this browser while the target composer loads. The editor inserts plain text. */
type Request = { text: string; at: number };
const pending = new Map<string, Request[]>();
const composers = new Map<string, (text: string) => void>();
export function appChatIntent(path: string): { prompt: string } | null {
  const url = new URL(path, "https://app.invalid");
  if (url.origin !== "https://app.invalid" || url.pathname !== "/__host/chat")
    return null;
  const prompt = url.searchParams.get("prompt") ?? "";
  if (prompt.length > 2000) throw new Error("The app question is too long.");
  return { prompt };
}
export function requestAppChatDraft(chatId: string, text: string) {
  if (text.length > 2000) throw new Error("The app question is too long.");
  const composer = composers.get(chatId);
  if (composer) {
    composer(text);
    return;
  }
  const requests = pending.get(chatId) ?? [];
  pending.set(chatId, [...requests.slice(-9), { text, at: Date.now() }]);
}
export function registerAppChatComposer(
  chatId: string,
  append: (text: string) => void,
) {
  composers.set(chatId, append);
  const requests = pending.get(chatId) ?? [];
  pending.delete(chatId);
  for (const request of requests)
    if (Date.now() - request.at < 60_000) append(request.text);
  return () => {
    if (composers.get(chatId) === append) composers.delete(chatId);
  };
}
