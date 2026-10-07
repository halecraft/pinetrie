// web/name-input — the name field of the identification screen and of
// your profile page: one rule (`normalizeName`, through `identity.ts`) and one
// wording for both.

import { MAX_NAME_LENGTH } from "@pinetrie/core"
import { nameHint } from "@pinetrie/interface"

/** Why `normalizeName` refuses a name, in the client's words. */
export const NAME_PROBLEM = `a name with a letter or digit, up to ${MAX_NAME_LENGTH} characters, and not “agent”`

export interface NameProblem {
  /**
   * `name` for the client's own rule; a refusal's code for the host's;
   * `failed` when the host failed carrying the rename out.
   */
  readonly code: string
  readonly message: string
}

export function NameInput({
  value,
  onChange,
  problem,
}: {
  value: string
  onChange: (value: string) => void
  problem: NameProblem | null
}) {
  const hint = nameHint(value)
  return (
    <>
      <label>
        name:{" "}
        <input
          autoComplete="name"
          name="name"
          onChange={e => onChange(e.target.value)}
          value={value}
        />
      </label>
      {hint !== null && (
        <p className="name-handle">others mention you as @{hint}</p>
      )}
      {problem !== null && (
        <p className="name-problem" data-problem={problem.code} role="alert">
          {problem.message}
        </p>
      )}
    </>
  )
}
