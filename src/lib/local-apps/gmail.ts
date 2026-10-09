import { z } from "zod/v4";
const id = z.string().min(1).max(256),
  page = z.string().max(2000).nullish();
const inputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("profile") }).strict(),
  z
    .object({
      mode: z.enum(["list", "search"]),
      query: z.string().max(2000),
      pageToken: page,
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z.object({ mode: z.literal("message"), messageId: id }).strict(),
  z
    .object({ mode: z.literal("attachment"), messageId: id, attachmentId: id })
    .strict(),
  z
    .object({
      mode: z.literal("history"),
      cursor: z.string().regex(/^\d+$/).max(128),
      pageToken: page,
    })
    .strict(),
]);
export function gmailBrokerRequest(value: Record<string, unknown>) {
  const input = inputSchema.parse(value);
  switch (input.mode) {
    case "profile":
      return { name: "gmail.get_profile", input: {} };
    case "list":
    case "search":
      return {
        name: "gmail.search_messages",
        input: {
          query: input.query,
          maxResults: input.limit ?? 100,
          ...(input.pageToken ? { pageToken: input.pageToken } : {}),
        },
      };
    case "message":
      return {
        name: "gmail.read_message",
        input: { messageId: input.messageId },
      };
    case "attachment":
      return {
        name: "gmail.get_attachment",
        input: { messageId: input.messageId, attachmentId: input.attachmentId },
      };
    case "history":
      return {
        name: "gmail.list_history",
        input: {
          startHistoryId: input.cursor,
          ...(input.pageToken ? { pageToken: input.pageToken } : {}),
        },
      };
  }
}
