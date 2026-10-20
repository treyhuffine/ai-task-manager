/**
 * Data from an app for the model, wrapped in a tag it can't close: every `<`
 * in the JSON is escaped, so nothing inside can end the block and write past
 * it. Used for a local app's `<app-data>` and connected apps'
 * `<connected-app-data>`.
 */
export function dataBlock(tag: string, value: unknown): string {
  return `<${tag}>\n${JSON.stringify(value).replace(/</g, '\\u003c')}\n</${tag}>`;
}
