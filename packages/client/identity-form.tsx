// client/identity-form — who you are, asked once per device (ADR-0037).
//
// Drawn before anything connects: a person is their email, the principal the
// Exchange names, so there is nothing to connect as until it is known. The
// name is a seed for the session's display name (`nameOnJoin`).

import { useState } from "react"
import { createRoot } from "react-dom/client"
import { type Identity, parseIdentity } from "./identity.ts"

const PROBLEMS = {
  email: "an email address, like ada@example.com",
  name: "a name with a letter or digit, up to 40 characters, and not “agent”",
} as const

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
      <h1>pineta</h1>
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
      <label>
        name:{" "}
        <input
          autoComplete="name"
          name="name"
          onChange={e => setName(e.target.value)}
          value={name}
        />
      </label>
      {problem !== null && (
        <p className="identity-problem" data-problem={problem} role="alert">
          {PROBLEMS[problem]}
        </p>
      )}
      <button type="submit">join</button>
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
