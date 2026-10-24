// web/machine-page — the machine lanes run on, drawn as the setup page is:
// the host's facts (`GET /machine`), asked for again at the sample's
// cadence while the page is open, each answer replacing the last, worded by
// `machinePageWords` (`@pinetrie/interface`). Its actions are only those
// the facts carry, each confirmed in place first.

import {
  errorText,
  MACHINE_SAMPLE_MS,
  type MachinePageFacts,
  type ThreadId,
} from "@pinetrie/core"
import {
  type Intent,
  type MachineLine,
  type MachineThreadLine,
  machineAskPrefill,
  machinePageView,
  machinePageWords,
  type ThreadMove,
} from "@pinetrie/interface"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Button } from "./button.tsx"
import { useCopy } from "./copy.ts"
import { Toast } from "./toast.tsx"

/** The host's facts, as last fetched; `waiting` before the first answer. */
type Fetched =
  | { readonly kind: "waiting" }
  | { readonly kind: "read"; readonly facts: MachinePageFacts | null }
  | { readonly kind: "failed"; readonly why: string }

/** `/machine`, now and every sample while mounted; a fetch the page outlives is aborted. */
function useMachineFacts(): Fetched {
  const [fetched, setFetched] = useState<Fetched>({ kind: "waiting" })
  useEffect(() => {
    const controller = new AbortController()
    const ask = () =>
      fetch("/machine", { signal: controller.signal, cache: "no-store" })
        .then(async response => {
          if (!response.ok)
            throw new Error(`the host answered ${response.status}`)
          setFetched({
            kind: "read",
            facts: (await response.json()) as MachinePageFacts | null,
          })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setFetched({ kind: "failed", why: errorText(error) })
        })
    void ask()
    const timer = setInterval(() => void ask(), MACHINE_SAMPLE_MS)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [])
  return fetched
}

/** The diagnostics' text, fetched when asked for. */
async function fetchDiagnostics(): Promise<string> {
  const response = await fetch("/machine/diagnostics", { cache: "no-store" })
  if (!response.ok) throw new Error(`the host answered ${response.status}`)
  return response.text()
}

/** A button that asks first: its confirmation in place, then Confirm or Cancel. */
function Confirmed({
  className,
  label,
  confirm,
  disabled = false,
  confirmWord,
  cancelWord,
  onConfirm,
}: {
  className: string
  label: string
  confirm: string
  disabled?: boolean
  confirmWord: string
  cancelWord: string
  onConfirm: () => void
}) {
  const [asking, setAsking] = useState(false)
  if (!asking)
    return (
      <Button
        className={className}
        disabled={disabled}
        look="outline"
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
    )
  return (
    <fieldset className="machine-confirm">
      <legend className="machine-confirm-text">{confirm}</legend>
      <Button
        className={`${className}-confirm`}
        look="primary"
        onClick={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        {confirmWord}
      </Button>
      <Button look="plain" onClick={() => setAsking(false)}>
        {cancelWord}
      </Button>
    </fieldset>
  )
}

function Lines({
  lines,
  render,
}: {
  lines: readonly MachineLine[]
  render?: (line: MachineLine) => ReactNode
}) {
  return (
    <ul className="machine-lines">
      {lines.map(l => (
        <li data-unreadable={l.unreadable} key={l.key}>
          {render?.(l) ?? l.text}
        </li>
      ))}
    </ul>
  )
}

export interface MachinePageProps {
  /** The board's move of a lane's canvas to the archive; null where none is offered. */
  readonly archiveMove: (lane: ThreadId) => ThreadMove | null
  readonly onIntent: (intent: Intent) => void
  /** Opens a lane's thread. */
  readonly openThread: (lane: ThreadId) => void
  /** Asks the host for the failed repair again: its outcome's refusal, or null. */
  readonly repairAgain: () => Promise<string | null>
}

export function MachinePage(p: MachinePageProps) {
  const fetched = useMachineFacts()
  const { copied, copy } = useCopy()
  const [diagnostics, setDiagnostics] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const shown = useRef<HTMLPreElement>(null)
  const text = machinePageWords(
    machinePageView(
      fetched.kind === "read" ? fetched.facts : null,
      p.archiveMove,
    ),
  )
  if (fetched.kind === "waiting") return null
  if (fetched.kind === "failed")
    return <p className="machine-failed">{fetched.why}</p>
  if (text.noMachine !== null)
    return <p className="machine-none">{text.noMachine}</p>
  const { now, threads, machine, host, lately } = text.sections
  const withDiagnostics = (then: (t: string) => void) =>
    fetchDiagnostics().then(
      t => {
        // Drawn before the copy: a page with no clipboard selects it instead.
        flushSync(() => setDiagnostics(t))
        then(t)
      },
      (error: unknown) => setSaid(errorText(error)),
    )
  return (
    <div className="machine-page">
      <div className="machine-actions">
        <Button
          className="machine-copy"
          look="outline"
          onClick={() =>
            void withDiagnostics(t =>
              copy(t, shown.current === null ? [] : [shown.current]),
            )
          }
        >
          {copied ? text.copy.copied : text.copy.label}
        </Button>
        <Button
          className="machine-ask"
          look="outline"
          onClick={() =>
            void withDiagnostics(t =>
              p.onIntent({ kind: "new-canvas", prefill: machineAskPrefill(t) }),
            )
          }
          title={text.ask.title}
        >
          {text.ask.label}
        </Button>
        {text.repairAgain !== null && (
          <Confirmed
            cancelWord={text.cancel}
            className="machine-repair-again"
            confirm={text.repairAgain.confirm}
            confirmWord={text.confirm}
            label={text.repairAgain.label}
            onConfirm={() => void p.repairAgain().then(setSaid)}
          />
        )}
      </div>
      <section aria-label={now.heading} className="machine-now">
        <h2>{now.heading}</h2>
        <ul className="machine-lines">
          {now.lines.map(l => (
            <li data-unreadable={l.unreadable} key={l.key}>
              {l.text}
              {l.doing !== null && <p className="machine-doing">{l.doing}</p>}
              {l.youCan !== null && (
                <p className="machine-you-can">{l.youCan}</p>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section aria-label={threads.heading} className="machine-threads">
        <h2>{threads.heading}</h2>
        {threads.lines.length === 0 ? (
          <p>{threads.empty}</p>
        ) : (
          <ul className="machine-lines">
            {threads.lines.map((l: MachineThreadLine) => (
              <li data-lane={l.lane} data-unreadable={l.unreadable} key={l.key}>
                <Button
                  className="machine-thread"
                  look="plain"
                  onClick={() => p.openThread(l.lane)}
                >
                  {l.text}
                </Button>
                {l.archive !== null && (
                  <Confirmed
                    cancelWord={text.cancel}
                    className="machine-archive"
                    confirm={l.archive.refused ?? l.archive.confirm}
                    confirmWord={text.confirm}
                    disabled={l.archive.refused !== null}
                    label={l.archive.label}
                    onConfirm={() => {
                      if (l.archive !== null) p.onIntent(l.archive.intent)
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={machine.heading} className="machine-machine">
        <h2>{machine.heading}</h2>
        <Lines lines={machine.lines} />
      </section>
      <section aria-label={host.heading} className="machine-host">
        <h2>{host.heading}</h2>
        <Lines lines={host.lines} />
      </section>
      <section aria-label={lately.heading} className="machine-lately">
        <h2>{lately.heading}</h2>
        {lately.lines.length === 0 ? (
          <p>{lately.empty}</p>
        ) : (
          <ol className="machine-lines">
            {lately.lines.map(l => (
              <li key={l.key}>
                <time dateTime={new Date(l.at).toISOString()}>
                  {new Date(l.at).toLocaleString()}
                </time>{" "}
                {l.text}
              </li>
            ))}
          </ol>
        )}
      </section>
      {diagnostics !== null && (
        <details className="machine-diagnostics" open>
          <summary>{text.copy.label}</summary>
          <pre ref={shown}>{diagnostics}</pre>
        </details>
      )}
      {said !== null && (
        <Toast action={null} onDismiss={() => setSaid(null)} text={said} />
      )}
    </div>
  )
}
