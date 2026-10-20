// web/history-page — a folder project's history, drawn as the setup page is:
// accepted work's kept line, newest first (`historyView`), each entry's
// review opened in place and fetched only then, and a restore of an earlier
// version through its preview: the review from what the folder holds now
// to it, whose own value `{ of, from }` the restore sends.

import type { RestorePreview } from "@pinetrie/core"
import {
  type HistoryEntry,
  type HistoryView,
  restoreWords,
} from "@pinetrie/interface"
import { decodeRevisionReview, reviewUrl } from "@pinetrie/rules"
import { useState } from "react"
import { Button } from "./button.tsx"
import { ReviewPane } from "./review-pane.tsx"
import { useFetched } from "./use-fetched.ts"

const readFiles = async (response: Response): Promise<number> =>
  decodeRevisionReview(await response.json())?.files.length ?? 0

export interface HistoryPageProps {
  view: HistoryView
  restore: (preview: RestorePreview) => void
  /** Your restore out now, or what it was refused with; null for none. */
  acting: { readonly waiting: boolean; readonly said: string | null }
  narrow: boolean
}

/** A restore's preview: the review from what the folder holds to the version, with nothing to restore when empty. */
function Preview({
  preview,
  when,
  restore,
  cancel,
  waiting,
  narrow,
}: {
  preview: RestorePreview
  when: string
  restore: () => void
  cancel: () => void
  waiting: boolean
  narrow: boolean
}) {
  const span = { kind: "range", from: preview.from, to: preview.of } as const
  const [files] = useFetched([reviewUrl(span)], readFiles)
  const empty = files?.kind === "ready" && files.value === 0
  return (
    <div className="history-preview">
      {empty ? (
        <p className="history-held">{restoreWords.held}</p>
      ) : (
        <>
          <p>{restoreWords.preview(when)}</p>
          <ReviewPane
            close={cancel}
            line=""
            narrow={narrow}
            target={{ spans: [span], conflicts: [], workingCopyEdits: [] }}
          />
        </>
      )}
      <div className="history-actions">
        {!empty && (
          <Button
            look="primary"
            className="history-restore-confirm"
            disabled={waiting || files?.kind !== "ready"}
            onClick={restore}
          >
            {restoreWords.confirm}
          </Button>
        )}
        <Button look="primary" className="history-cancel" onClick={cancel}>
          {restoreWords.cancel}
        </Button>
      </div>
    </div>
  )
}

function Entry({
  entry,
  opened,
  setOpened,
  previewing,
  setPreviewing,
  p,
}: {
  entry: HistoryEntry
  opened: string | null
  setOpened: (id: string | null) => void
  previewing: string | null
  setPreviewing: (id: string | null) => void
  p: HistoryPageProps
}) {
  const open = opened === entry.id
  return (
    <li
      className="history-entry"
      data-made={entry.made.kind}
      data-state={entry.id}
    >
      <div className="history-line">
        <span className="history-words">{entry.words}</span>
        <span className="history-who">
          {entry.who === null ? entry.when : `${entry.who} · ${entry.when}`}
        </span>
        {entry.review !== null && (
          <Button
            look="primary"
            aria-expanded={open}
            className="history-review"
            onClick={() => setOpened(open ? null : entry.id)}
          >
            {restoreWords.review}
          </Button>
        )}
        {entry.restore !== null && (
          <Button
            look="primary"
            className="history-restore"
            disabled={p.acting.waiting}
            onClick={() => setPreviewing(entry.id)}
          >
            {restoreWords.offer}
          </Button>
        )}
      </div>
      {open && entry.review !== null && (
        <ReviewPane
          close={() => setOpened(null)}
          line=""
          narrow={p.narrow}
          target={{
            spans: [entry.review],
            conflicts: [],
            workingCopyEdits: [],
          }}
        />
      )}
      {previewing === entry.id && entry.restore !== null && (
        <Preview
          cancel={() => setPreviewing(null)}
          narrow={p.narrow}
          preview={entry.restore}
          restore={() => {
            if (entry.restore !== null) p.restore(entry.restore)
            setPreviewing(null)
          }}
          waiting={p.acting.waiting}
          when={entry.when}
        />
      )}
      {entry.saves.length > 0 && (
        <ul className="history-saves">
          {entry.saves.map(s => (
            <Entry
              entry={s}
              key={s.id}
              opened={opened}
              p={p}
              previewing={previewing}
              setOpened={setOpened}
              setPreviewing={setPreviewing}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function HistoryPage(p: HistoryPageProps) {
  const [opened, setOpened] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  if (p.view.entries.length === 0)
    return <p className="history-empty">{restoreWords.empty}</p>
  return (
    <div className="history">
      {p.acting.said !== null && (
        <p className="history-said" role="status">
          {p.acting.said}
        </p>
      )}
      <ol className="history-entries">
        {p.view.entries.map(e => (
          <Entry
            entry={e}
            key={e.id}
            opened={opened}
            p={p}
            previewing={previewing}
            setOpened={setOpened}
            setPreviewing={setPreviewing}
          />
        ))}
      </ol>
      {p.view.notKept !== "" && (
        <p className="history-not-kept">{p.view.notKept}</p>
      )}
    </div>
  )
}
