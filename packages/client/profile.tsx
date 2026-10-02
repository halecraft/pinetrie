// client/profile — you, at the header's right: your name, the handle it gives
// you, your email, and signing in as someone else (ADR-0037).
//
// A dialog, not a `Menu`: a `role="menu"` may hold only menu items, and this
// holds a text field. A rename is sent on Enter or save and discarded on
// Escape or a click elsewhere; saving on blur would race the popover
// unmounting the field.

import type { WriterId } from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import { useState } from "react"
import { planRename, renameProblem } from "./identity.ts"
import { NAME_PROBLEM, NameInput, type NameProblem } from "./name-input.tsx"
import { Popover } from "./popover.tsx"
import { Initial, nameFor } from "./presence.tsx"

export interface Me {
  readonly writer: WriterId
  /** `session.principal`: your email. */
  readonly email: string
  readonly rename: (name: string) => Promise<Outcome>
  /** Forget who this device says you are, and ask again. */
  readonly signOut: () => void
}

export function Profile({
  writer,
  email,
  rename,
  signOut,
  nameOf,
  colorOf,
}: Me & {
  readonly nameOf: ReadonlyMap<WriterId, string>
  readonly colorOf: (writer: WriterId) => string
}) {
  const shown = nameFor(nameOf, writer)
  const [draft, setDraft] = useState(shown)
  const [problem, setProblem] = useState<NameProblem | null>(null)
  return (
    <Popover
      boxClassName="popover profile"
      className="you"
      heading="You"
      id="profile"
      label={`you: ${shown}`}
      onOpen={box => {
        setDraft(shown)
        setProblem(null)
        const input = box.querySelector<HTMLInputElement>('input[name="name"]')
        input?.focus()
        input?.select()
      }}
      role="dialog"
      title={shown}
      trigger={
        <Initial
          className="me"
          colorOf={colorOf}
          nameOf={nameOf}
          writer={writer}
        />
      }
      triggerClassName="me-trigger"
    >
      {({ close }) => (
        <>
          <form
            onSubmit={async e => {
              e.preventDefault()
              const plan = planRename(draft, nameOf.get(writer))
              if (plan.kind === "refuse") {
                setProblem({ code: "name", message: NAME_PROBLEM })
                return
              }
              if (plan.kind === "send") {
                const problem = renameProblem(await rename(plan.name))
                if (problem !== null) {
                  setProblem(problem)
                  return
                }
              }
              close(true)
            }}
          >
            <NameInput
              onChange={v => {
                setDraft(v)
                setProblem(null)
              }}
              problem={problem}
              value={draft}
            />
            <button className="profile-save" type="submit">
              save
            </button>
          </form>
          <p className="profile-email">{email}</p>
          <button className="not-you" onClick={signOut} type="button">
            Not you? Sign in as someone else
          </button>
        </>
      )}
    </Popover>
  )
}
