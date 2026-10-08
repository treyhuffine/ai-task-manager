/**
 * Whether agents may change a linked folder (docs/reference-folders-spec.md §7).
 *
 * `reference_folders.read_only` is a preference with no schema default: null
 * means the person never chose, and resolves here, so every reader (the
 * prompt, the tool filters, the Setup tab, a session on another device) agrees
 * on one default. Linked folders are editable unless marked read only.
 */
export const READ_ONLY_DEFAULT = false;

export function isReadOnly(ref: { readOnly?: boolean | null }): boolean {
  return ref.readOnly ?? READ_ONLY_DEFAULT;
}
