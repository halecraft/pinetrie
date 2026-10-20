// web/profile-page — your profile: your picture (`picture-field.tsx`), your
// name, the handle it gives you, and your email. A page of its own, opened from
// the menu your avatar opens (`account-menu.tsx`).
//
// A rename is sent on Enter or save, never on blur: a click on "← back" or
// the sidebar would blur the field and send a name you were still typing.

import type { Sha256, WriterId } from "@pinetrie/core"
import { planRename, profileWords, renameProblem } from "@pinetrie/interface"
import type { Outcome } from "@pinetrie/protocol/codec"
import { useState } from "react"
import { Button } from "./button.tsx"
import { NAME_PROBLEM, NameInput, type NameProblem } from "./name-input.tsx"
import { PictureField } from "./picture-field.tsx"
import { nameFor } from "./presence.tsx"

export function ProfilePage({
  writer,
  email,
  rename,
  setPicture,
  nameOf,
  colorOf,
}: {
  readonly writer: WriterId
  /** `session.principal`: your email. */
  readonly email: string
  readonly rename: (name: string) => Promise<Outcome>
  readonly setPicture: (sha256: Sha256 | null) => Promise<Outcome>
  readonly nameOf: ReadonlyMap<WriterId, string>
  readonly colorOf: (writer: WriterId) => string
}) {
  // The name shown when the page opened: another device's rename meanwhile
  // does not overwrite what you are typing.
  const [draft, setDraft] = useState(() => nameFor(nameOf, writer))
  const [problem, setProblem] = useState<NameProblem | null>(null)
  const [saved, setSaved] = useState(false)
  return (
    <div className="profile-page">
      <PictureField
        colorOf={colorOf}
        nameOf={nameOf}
        setPicture={setPicture}
        writer={writer}
      />
      <form
        className="profile-name"
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
          setSaved(true)
        }}
      >
        <NameInput
          onChange={v => {
            setDraft(v)
            setProblem(null)
            setSaved(false)
          }}
          problem={problem}
          value={draft}
        />
        <div className="profile-actions">
          {saved && (
            <span className="profile-saved" role="status">
              {profileWords.saved}
            </span>
          )}
          <Button look="primary" className="profile-save" type="submit">
            {profileWords.save}
          </Button>
        </div>
      </form>
      <p className="profile-email">{email}</p>
    </div>
  )
}
