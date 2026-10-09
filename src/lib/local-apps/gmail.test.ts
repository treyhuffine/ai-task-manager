import { it, expect } from "vitest";
import { gmailBrokerRequest } from "./gmail";
it("matches Finance mailbox modes and the generic provider inputs without raw URLs or credentials", () => {
  expect(gmailBrokerRequest({ mode: "profile" })).toEqual({
    name: "gmail.get_profile",
    input: {},
  });
  expect(
    gmailBrokerRequest({ mode: "list", query: "receipt", pageToken: "page-2" }),
  ).toEqual({
    name: "gmail.search_messages",
    input: { query: "receipt", maxResults: 100, pageToken: "page-2" },
  });
  expect(
    gmailBrokerRequest({ mode: "message", messageId: "message-1" }),
  ).toEqual({ name: "gmail.read_message", input: { messageId: "message-1" } });
  expect(
    gmailBrokerRequest({
      mode: "attachment",
      messageId: "message-1",
      attachmentId: "attachment-1",
    }),
  ).toEqual({
    name: "gmail.get_attachment",
    input: { messageId: "message-1", attachmentId: "attachment-1" },
  });
  expect(
    gmailBrokerRequest({ mode: "history", cursor: "123", pageToken: null }),
  ).toEqual({ name: "gmail.list_history", input: { startHistoryId: "123" } });
  expect(() =>
    gmailBrokerRequest({ mode: "history", cursor: "http://example.test" }),
  ).toThrow();
  expect(() =>
    gmailBrokerRequest({
      mode: "list",
      query: "receipt",
      accessToken: "fixture",
    }),
  ).toThrow();
});
