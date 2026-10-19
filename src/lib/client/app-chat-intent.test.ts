import { expect, it, vi } from "vitest";
import {
  appChatIntent,
  appPartsText,
  registerAppChatComposer,
  requestAppChatDraft,
  requestAppChatMessage,
  serializeAppParts,
  type AppDraftPart,
} from "./app-chat-intent";
it("handles only the bounded local chat intent", () => {
  expect(appChatIntent("/__host/chat?prompt=Explain%20this")).toEqual({
    prompt: "Explain this",
  });
  expect(appChatIntent("/__host/chat")).toEqual({ prompt: "" });
  expect(appChatIntent("https://elsewhere.test/__host/chat")).toBeNull();
  expect(appChatIntent("//elsewhere.test/__host/chat")).toBeNull();
  expect(appChatIntent("/views/a")).toBeNull();
  expect(() =>
    appChatIntent("/__host/chat?prompt=" + "x".repeat(2001)),
  ).toThrow(/too long/);
});
it("stages into only the selected composer, once, even if the composer loads later", () => {
  const a = vi.fn(),
    b = vi.fn();
  const offB = registerAppChatComposer("draft-b", b);
  requestAppChatDraft("draft-a", "<b>literal text</b>");
  expect(b).not.toHaveBeenCalled();
  const offA = registerAppChatComposer("draft-a", a);
  expect(a).toHaveBeenCalledExactlyOnceWith("<b>literal text</b>");
  offA();
  const offAgain = registerAppChatComposer("draft-a", a);
  expect(a).toHaveBeenCalledTimes(1);
  requestAppChatDraft("draft-a", "Next question");
  expect(a).toHaveBeenLastCalledWith("Next question");
  offAgain();
  offB();
});
const attachment = { fileName: "01900000-0000-7000-8000-000000000001.png", originalName: "Front view.png", mimeType: "image/png", size: 68, uploadedAt: "2026-10-19T00:00:00.000Z" };
const parts: AppDraftPart[] = [
  { type: "text", text: "Explain the clearance of" },
  { type: "snippet", title: "M6 hex bolt", text: "Selected: M6 hex bolt" },
  { type: "file", attachment },
];
it("serializes app parts as the composer sends chips: titled items as their text, files as markers", () => {
  expect(serializeAppParts(parts)).toEqual({ text: `Explain the clearance of Selected: M6 hex bolt [[file:${attachment.fileName}]]`, attachments: [attachment] });
  expect(appPartsText(parts)).toBe("Explain the clearance of Selected: M6 hex bolt");
});
it("sends through a composer that can send, as the app, and drafts otherwise", async () => {
  const fromApp = { viewId: "view-1", app: "Bits & Bolts" };
  const send = vi.fn(async () => {}), appendParts = vi.fn(), append = vi.fn();
  const off = registerAppChatComposer("rich", append, { appendParts, send });
  expect(await requestAppChatMessage("rich", { parts, send: true, fromApp })).toBe("sent");
  expect(send).toHaveBeenCalledExactlyOnceWith(parts, fromApp);
  expect(await requestAppChatMessage("rich", { parts, send: false, fromApp })).toBe("drafted");
  expect(appendParts).toHaveBeenCalledExactlyOnceWith(parts);
  // A refused send keeps what the app wrote, in the draft.
  send.mockRejectedValueOnce(new Error("Archived"));
  expect(await requestAppChatMessage("rich", { parts, send: true, fromApp })).toBe("drafted");
  expect(appendParts).toHaveBeenCalledTimes(2);
  expect(append).not.toHaveBeenCalled();
  off();
  // A text-only composer gets the text.
  const offText = registerAppChatComposer("plain", append);
  expect(await requestAppChatMessage("plain", { parts, send: true })).toBe("drafted");
  expect(append).toHaveBeenCalledExactlyOnceWith("Explain the clearance of Selected: M6 hex bolt");
  offText();
});
it("holds a send for a chat that is still opening, then sends it once", async () => {
  expect(await requestAppChatMessage("opening", { parts, send: true, fromApp: { viewId: "view-2", app: "Bits & Bolts" } })).toBe("queued");
  const send = vi.fn(async () => {});
  const off = registerAppChatComposer("opening", vi.fn(), { appendParts: vi.fn(), send });
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  off();
  const again = vi.fn(async () => {});
  const offAgain = registerAppChatComposer("opening", vi.fn(), { send: again });
  await Promise.resolve();
  expect(again).not.toHaveBeenCalled();
  offAgain();
});
it("does not put an old abandoned question into a later composer", () => {
  vi.useFakeTimers();
  requestAppChatDraft("expired", "Old question");
  vi.advanceTimersByTime(60001);
  const append = vi.fn(),
    off = registerAppChatComposer("expired", append);
  expect(append).not.toHaveBeenCalled();
  off();
  vi.useRealTimers();
});
