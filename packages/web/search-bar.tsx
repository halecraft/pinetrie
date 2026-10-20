// web/search-bar — the search of the root you are on: the 🔍 at the rail's top,
// and the bar it opens across the workspace's top. Every key is `keyAct`'s,
// Escape in the field included; what is typed is a search act, kept in `App`.

import {
  type Intent,
  SEARCH_CLEAR,
  SEARCH_CLOSE_TITLE,
  SEARCH_DONE,
  SEARCH_DONE_TITLE,
  SEARCH_FIELD_LABEL,
  SEARCH_OPEN_TITLE,
} from "@pinetrie/interface"
import { type RefObject, useLayoutEffect } from "react"
import { Button, IconButton } from "./button.tsx"

/** The 🔍: it opens the bar, and, pressed while the bar is open, closes it. */
export function SearchToggle({
  open,
  onIntent,
  toggle,
}: {
  open: boolean
  onIntent: (intent: Intent) => void
  toggle?: RefObject<HTMLButtonElement | null>
}) {
  const title = open ? SEARCH_CLOSE_TITLE : SEARCH_OPEN_TITLE
  return (
    <IconButton
      look="outline"
      aria-keyshortcuts={open ? "Escape" : "/"}
      label={title}
      aria-pressed={open}
      className="search-toggle"
      onClick={() =>
        onIntent({ kind: "search", act: { kind: open ? "close" : "open" } })
      }
      ref={toggle}
    >
      🔍
    </IconButton>
  )
}

/** The bar: the pressed 🔍 over the rail, the field and its ⌫, the line, and done. */
export function SearchBar({
  query,
  line,
  onIntent,
  field,
}: {
  query: string
  line: string
  onIntent: (intent: Intent) => void
  field: RefObject<HTMLInputElement | null>
}) {
  // Opening moves focus into the field.
  useLayoutEffect(() => {
    field.current?.focus()
  }, [field])
  return (
    <search className="search-bar">
      <div className="search-lead">
        <SearchToggle onIntent={onIntent} open />
      </div>
      <div className="search-box">
        <input
          aria-label={SEARCH_FIELD_LABEL}
          autoComplete="off"
          className="search-field"
          onChange={e =>
            onIntent({
              kind: "search",
              act: { kind: "type", query: e.target.value },
            })
          }
          placeholder={SEARCH_FIELD_LABEL}
          ref={field}
          spellCheck={false}
          type="text"
          value={query}
        />
        {query !== "" && (
          <IconButton
            label={SEARCH_CLEAR}
            className="search-clear"
            onClick={() => {
              onIntent({ kind: "search", act: { kind: "clear" } })
              field.current?.focus()
            }}
          >
            ⌫
          </IconButton>
        )}
      </div>
      <span aria-live="polite" className="search-line">
        {line}
      </span>
      <Button
        look="outline"
        className="search-done"
        onClick={() => onIntent({ kind: "search", act: { kind: "close" } })}
        title={SEARCH_DONE_TITLE}
      >
        {SEARCH_DONE}
      </Button>
    </search>
  )
}
