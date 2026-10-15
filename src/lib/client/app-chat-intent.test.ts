import { expect, it, vi } from "vitest";
import {
  appChatIntent,
  registerAppChatComposer,
  requestAppChatDraft,
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
