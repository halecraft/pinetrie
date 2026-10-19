// interface/folder-words — the check that a folder project's views speak no
// jj: every string a view holds (`wordsIn`), and which of them name one of
// jj's words (`jjWordsIn`). A folder project has no commits, bookmarks,
// revisions, repo, stack, WIP or publish, so a label that says one is
// wrong there.

/** jj's words, which no label a folder project's views produce may hold. */
const JJ_WORD =
  /\b(commit|commits|bookmark|bookmarks|revision|revisions|repo|repos|stack|stacks|WIP|WIPs|publish|published|publishing)\b/i

/** Every string `value` holds, at any depth: a view's labels, titles and lines. */
function wordsIn(value: unknown): readonly string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(wordsIn)
  if (value instanceof Map) return [...value.values()].flatMap(wordsIn)
  if (typeof value === "object" && value !== null)
    return Object.values(value).flatMap(wordsIn)
  return []
}

/** Each string of `value` that names one of jj's words. */
export const jjWordsIn = (value: unknown): readonly string[] =>
  wordsIn(value).filter(w => JJ_WORD.test(w))
