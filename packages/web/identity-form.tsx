// web/identity-form — who you are, asked once per device.
//
// Drawn before anything connects: a person is their email, the principal the
// Exchange names, so there is nothing to connect as until it is known. The
// name is a seed for the session's display name (`reconcileName`); its field
// is your profile's too (`name-input.tsx`).

import { PRODUCT_NAME } from "@pinetrie/core"
import { type Identity, parseIdentity } from "@pinetrie/interface"
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { Button } from "./button.tsx"
import { NAME_PROBLEM, NameInput } from "./name-input.tsx"

const EMAIL_PROBLEM = "an email address, like ada@example.com"

function IdentityForm({ onDone }: { onDone: (identity: Identity) => void }) {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [problem, setProblem] = useState<"email" | "name" | null>(null)
  return (
    <form
      id="identity"
      // The rule is `parseIdentity`'s, the host's own, not the browser's.
      noValidate
      onSubmit={e => {
        e.preventDefault()
        const parsed = parseIdentity(email, name)
        if (parsed.ok) onDone(parsed.identity)
        else setProblem(parsed.problem)
      }}
    >
      <h1>{PRODUCT_NAME}</h1>
      <label>
        email:{" "}
        <input
          autoComplete="email"
          name="email"
          onChange={e => setEmail(e.target.value)}
          type="email"
          value={email}
        />
      </label>
      {problem === "email" && (
        <p className="identity-problem" data-problem="email" role="alert">
          {EMAIL_PROBLEM}
        </p>
      )}
      <NameInput
        onChange={setName}
        problem={
          problem === "name" ? { code: "name", message: NAME_PROBLEM } : null
        }
        value={name}
      />
      <Button look="primary" type="submit">
        join
      </Button>
    </form>
  )
}

/** Ask who you are in `container`; resolves once the form is filled in. */
export function askIdentity(container: HTMLElement): Promise<Identity> {
  const root = createRoot(container)
  return new Promise(resolve => {
    root.render(
      <IdentityForm
        onDone={identity => {
          root.unmount()
          resolve(identity)
        }}
      />,
    )
  })
}
