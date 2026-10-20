/**
 * Words in a note body for the editor footer. Markdown punctuation is left out,
 * so a heading marker or a list bullet on its own doesn't count as a word.
 */
export function countWords(body: string): number {
  const text = body.replace(/[#*_~`>\-\[\]()]/g, '').trim();
  return text ? text.split(/\s+/).length : 0;
}
