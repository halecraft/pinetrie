// web/health-page — how the machine lanes run on is doing: the host's facts
// (`GET /machine`), asked for again at the sample's cadence while the page
// is open, each answer replacing the last and a failed one keeping it,
// decided by `healthPageView` and worded by `healthPageWords`
// (`@pinetrie/interface`). Its actions are only those the facts carry, each
// confirmed in place first.

import {
  errorText,
  MACHINE_SAMPLE_MS,
  type MachineFacts,
  type ThreadId,
} from "@pinetrie/core"
import {
  type BarView,
  type HealthPageText,
  healthPageView,
  healthPageWords,
  type Intent,
  machineAskPrefill,
  notRefreshedWords,
  type ThreadMove,
  type VitalText,
} from "@pinetrie/interface"
import { useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Button } from "./button.tsx"
import { useCopy } from "./copy.ts"
import { HEALTH, MachineIcon } from "./icons.tsx"
import { Sparkline } from "./sparkline.tsx"
import { Toast } from "./toast.tsx"

/** The host's facts as last read, when they were read, and why the latest ask failed, if it did. */
type Fetched =
  | { readonly kind: "waiting"; readonly failed: string | null }
  | {
      readonly kind: "read"
      readonly facts: MachineFacts | null
      readonly at: number
      readonly failed: string | null
    }

/** `/machine`, now and every sample while mounted; a fetch the page outlives is aborted, and a failed one keeps what was read. */
function useMachineFacts(): Fetched {
  const [fetched, setFetched] = useState<Fetched>({
    kind: "waiting",
    failed: null,
  })
  useEffect(() => {
    const controller = new AbortController()
    const ask = () =>
      fetch("/machine", { signal: controller.signal, cache: "no-store" })
        .then(async response => {
          if (!response.ok)
            throw new Error(`the host answered ${response.status}`)
          const facts = (await response.json()) as MachineFacts | null
          setFetched({ kind: "read", facts, at: Date.now(), failed: null })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setFetched(last => ({ ...last, failed: errorText(error) }))
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
  look = "outline",
  onConfirm,
}: {
  className: string
  label: string
  confirm: string
  disabled?: boolean
  confirmWord: string
  cancelWord: string
  look?: "outline" | "plain"
  onConfirm: () => void
}) {
  const [asking, setAsking] = useState(false)
  if (!asking)
    return (
      <Button
        className={className}
        disabled={disabled}
        look={look}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
    )
  return (
    <fieldset className="health-confirm">
      <legend className="health-confirm-text">{confirm}</legend>
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

/** A bar: what is used, stacked; the first bound's near zone; each bound's mark. */
function Bar({ bar, text }: { bar: BarView; text: string }) {
  const used = bar.fills.reduce((sum, f) => sum + f, 0)
  let start = 0
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <meter> draws neither the bounds' marks nor the near zone, and styles apart in each browser
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(used * 100)}
      aria-valuetext={text}
      className="health-bar"
      role="meter"
    >
      {bar.near !== null && (
        <span
          className="health-bar-near"
          style={{
            left: `${bar.near.from * 100}%`,
            width: `${(bar.near.to - bar.near.from) * 100}%`,
          }}
        />
      )}
      {bar.fills.map((f, i) => {
        const left = start
        start += f
        return (
          <span
            className="health-bar-fill"
            data-part={i}
            // biome-ignore lint/suspicious/noArrayIndexKey: a part's place is its identity
            key={i}
            style={{ left: `${left * 100}%`, width: `${f * 100}%` }}
          />
        )
      })}
      {bar.marks.map((at, i) => (
        <span
          className="health-bar-mark"
          data-worst={i > 0}
          key={at}
          style={{ left: `${at * 100}%` }}
        />
      ))}
    </div>
  )
}

function Vital({ vital }: { vital: VitalText }) {
  return (
    <div
      className="health-vital"
      data-role="vital"
      data-status={vital.status.kind}
      data-vital={vital.name}
    >
      <div className="health-vital-head">
        <span>{vital.label}</span>
        <span className="health-pill" data-status={vital.status.kind}>
          {vital.status.word}
        </span>
      </div>
      <p className="health-vital-number">
        {vital.number} <span className="health-of">{vital.of}</span>
      </p>
      {vital.bar !== null && <Bar bar={vital.bar} text={vital.barText} />}
      {vital.series !== null && vital.seriesText !== null && (
        <Sparkline label={vital.seriesText} series={vital.series} />
      )}
      <p className="health-note">{vital.note}</p>
    </div>
  )
}

type MachineText = Extract<HealthPageText, { kind: "machine" }>

function Threads({
  text,
  onIntent,
  openThread,
}: {
  text: MachineText
  onIntent: (intent: Intent) => void
  openThread: (lane: ThreadId) => void
}) {
  const { threads } = text
  return (
    <section aria-label={threads.heading} className="health-threads">
      <h2>
        {threads.heading} <small>{threads.summary}</small>
      </h2>
      {threads.rows.length === 0 ? (
        <p>{threads.empty}</p>
      ) : (
        <div className="health-table-wrap">
          <table className="health-table">
            <thead>
              <tr>
                <th>{threads.columns.thread}</th>
                <th>{threads.columns.memory}</th>
                <th className="health-hour">{threads.columns.hour}</th>
                <th className="health-snapshots">
                  {threads.columns.snapshots}
                </th>
                <th>{threads.columns.state}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {threads.rows.map(r => (
                <tr
                  data-lane={r.lane}
                  data-role="thread"
                  data-unreadable={r.unreadable}
                  key={r.key}
                >
                  <td>
                    <Button
                      className="health-thread"
                      look="plain"
                      onClick={() => openThread(r.lane)}
                    >
                      {r.name}
                    </Button>
                  </td>
                  <td>
                    {r.memory}
                    {r.cache !== null && (
                      <span className="health-of"> · {r.cache}</span>
                    )}
                    {r.bar !== null && <Bar bar={r.bar} text={r.barText} />}
                  </td>
                  <td className="health-hour">
                    {r.series !== null && r.seriesText !== null && (
                      <Sparkline label={r.seriesText} series={r.series} />
                    )}
                  </td>
                  <td className="health-snapshots">{r.snapshots}</td>
                  <td>
                    <span
                      className="health-state"
                      data-tone={r.state.tone}
                      title={r.state.title ?? undefined}
                    >
                      {r.state.label}
                    </span>
                  </td>
                  <td>
                    {r.archive !== null && (
                      <Confirmed
                        cancelWord={text.cancel}
                        className="health-archive"
                        confirm={r.archive.refused ?? r.archive.confirm}
                        confirmWord={text.confirm}
                        disabled={r.archive.refused !== null}
                        label={r.archive.label}
                        look="plain"
                        onConfirm={() => {
                          if (r.archive !== null) onIntent(r.archive.intent)
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Happened({ text }: { text: MachineText }) {
  const { happened } = text
  return (
    <section
      aria-label={happened.heading}
      className="health-happened"
      data-role="happened"
    >
      <h2>
        {happened.heading} <small>{happened.span}</small>
      </h2>
      <div aria-label={happened.stripLabel} className="health-strip" role="img">
        {happened.strip.marks.map((m, i) => (
          <span
            className="health-strip-mark"
            data-tone={m.tone}
            // biome-ignore lint/suspicious/noArrayIndexKey: marks at one time are alike
            key={i}
            style={{ left: `${m.at * 100}%` }}
          />
        ))}
      </div>
      {happened.rows.length === 0 ? (
        <p>{happened.empty}</p>
      ) : (
        <ol className="health-events">
          {happened.rows.map(r => (
            <li data-tone={r.tone} key={r.key}>
              <time dateTime={new Date(r.at).toISOString()}>{r.when}</time>
              <span>{r.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Details({ text }: { text: MachineText }) {
  const { services, safeguards, settings } = text.details
  return (
    <section aria-label={text.details.heading} className="health-details">
      <h2>{text.details.heading}</h2>
      <details>
        <summary>
          {services.heading} <small>{services.summary}</small>
        </summary>
        {services.rows.map(s => (
          <div
            className="health-service"
            data-at-limit={s.atLimit}
            data-unreadable={s.unreadable}
            key={s.key}
          >
            <span>{s.label}</span>
            {s.bar === null ? <span /> : <Bar bar={s.bar} text={s.text} />}
            <span className="health-of">{s.text}</span>
          </div>
        ))}
      </details>
      <details>
        <summary>
          {safeguards.heading} <small>{safeguards.summary}</small>
        </summary>
        <ul className="health-safeguards">
          {safeguards.items.map(i => (
            <li data-mark={i.mark} key={i.key}>
              {i.text}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>
          {settings.heading} <small>{settings.summary}</small>
        </summary>
        <dl className="health-settings">
          {settings.items.map(i => (
            <div key={i.key}>
              <dt>{i.label}</dt>
              <dd>
                {i.value} {i.setting !== null && <code>{i.setting}</code>}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  )
}

export interface HealthPageProps {
  /** The board's move of a lane's canvas to the archive; null where none is offered. */
  readonly archiveMove: (lane: ThreadId) => ThreadMove | null
  readonly onIntent: (intent: Intent) => void
  /** Opens a lane's thread. */
  readonly openThread: (lane: ThreadId) => void
  /** Asks the host for the failed repair again: its outcome's refusal, or null. */
  readonly repairAgain: () => Promise<string | null>
}

export function HealthPage(p: HealthPageProps) {
  const fetched = useMachineFacts()
  const { copied, copy } = useCopy()
  const [diagnostics, setDiagnostics] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const shown = useRef<HTMLPreElement>(null)
  if (fetched.kind === "waiting")
    return fetched.failed === null ? null : (
      <p className="health-failed">{fetched.failed}</p>
    )
  const text = healthPageWords(
    healthPageView(fetched.facts, p.archiveMove, fetched.at),
  )
  if (text.kind === "no-machine")
    return <p className="health-none">{text.noMachine}</p>
  const withDiagnostics = (then: (t: string) => void) =>
    fetchDiagnostics().then(
      t => {
        // Drawn before the copy: a page with no clipboard selects it instead.
        flushSync(() => setDiagnostics(t))
        then(t)
      },
      (error: unknown) => setSaid(errorText(error)),
    )
  const { verdict } = text
  const look = verdict.quiet ? "plain" : "outline"
  return (
    <div className="health-page">
      <p className="health-machine">
        {text.machineLine}
        <span className="health-live" data-failed={fetched.failed !== null}>
          {fetched.failed === null
            ? text.live
            : notRefreshedWords(fetched.failed)}
        </span>
      </p>
      <section
        aria-label={verdict.title}
        className="health-verdict"
        data-health={HEALTH[verdict.state]}
        data-role="verdict"
      >
        <MachineIcon state={verdict.state} />
        <div>
          <p className="health-verdict-title">{verdict.title}</p>
          {verdict.sentence !== null && <p>{verdict.sentence}</p>}
          {verdict.doing !== null && <p>{verdict.doing}</p>}
          {verdict.youCan !== null && (
            <p className="health-you-can">you can {verdict.youCan}</p>
          )}
          {verdict.more.length > 0 && (
            <ul className="health-more">
              {verdict.more.map(m => (
                <li key={m.key}>
                  <b>{m.title}</b>: {m.sentence}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="health-actions">
          <Button
            className="health-ask"
            look={look}
            onClick={() =>
              void withDiagnostics(t =>
                p.onIntent({
                  kind: "new-canvas",
                  prefill: machineAskPrefill(t),
                }),
              )
            }
            title={text.ask.title}
          >
            {text.ask.label}
          </Button>
          <Button
            className="health-copy"
            look={look}
            onClick={() =>
              void withDiagnostics(t =>
                copy(t, shown.current === null ? [] : [shown.current]),
              )
            }
          >
            {copied ? text.copy.copied : text.copy.label}
          </Button>
          {text.repairAgain !== null && (
            <Confirmed
              cancelWord={text.cancel}
              className="health-repair-again"
              confirm={text.repairAgain.confirm}
              confirmWord={text.confirm}
              label={text.repairAgain.label}
              onConfirm={() => void p.repairAgain().then(setSaid)}
            />
          )}
        </div>
      </section>
      <section
        aria-label={text.vitals.heading}
        className="health-vitals-section"
      >
        <h2>
          {text.vitals.heading} <small>{text.vitals.note}</small>
        </h2>
        <div className="health-vitals">
          {text.vitals.items.map(v => (
            <Vital key={v.name} vital={v} />
          ))}
        </div>
      </section>
      <Threads onIntent={p.onIntent} openThread={p.openThread} text={text} />
      <Happened text={text} />
      <Details text={text} />
      {diagnostics !== null && (
        <details className="health-diagnostics" data-role="diagnostics" open>
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
