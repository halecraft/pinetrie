// host/ask-model — one request to a model outside every thread, with one of
// pine·trie's skills: the skill looked up, the request made, its tokens
// counted, and the reply read, each refused part of it logged.

import type { PiSetup } from "@pinetrie/pi"

/** A reply read: its value, and the parts of it refused, each named for the log. */
export interface ReplyRead<T> {
  readonly value: T
  readonly refused: readonly string[]
}

/** A reply that is one answer: refused whole, under `part`'s name, when null. */
export const oneAnswer =
  <T>(read: (reply: string) => T | null, part: string) =>
  (reply: string): ReplyRead<T | null> => {
    const value = read(reply)
    return { value, refused: value === null ? [part] : [] }
  }

/**
 * Ask `skill`'s model `request(skill's text)`, and read its reply with
 * `parse`. `value` is null when the skill is missing (logged) or the
 * request failed. A reply is always read whole: each part `parse` refuses is
 * logged, and the parts it kept stay, so a run's end keeps a good digest
 * beside a bad urgency line. `tokens` is what the request spent, none
 * without a skill.
 */
export async function askModel<T>(
  deps: {
    readonly piSetup: Pick<PiSetup, "skill" | "complete">
    readonly log: (line: string) => void
  },
  ask: {
    /** The skill's command name: `pinetrie:skill:<name>`. */
    readonly skill: string
    readonly request: (skill: string) => {
      readonly system: string
      readonly user: string
    }
    readonly parse: (reply: string) => ReplyRead<T>
    readonly purpose?: "title"
  },
): Promise<{ readonly value: T | null; readonly tokens: number }> {
  const skill = await deps.piSetup.skill(ask.skill)
  if (skill === null) {
    deps.log(`[host] no ${ask.skill.split(":").at(-1)} skill`)
    return { value: null, tokens: 0 }
  }
  const { text, tokens } = await deps.piSetup.complete({
    ...ask.request(skill.content),
    ...(ask.purpose === undefined ? {} : { purpose: ask.purpose }),
  })
  if (text === null) return { value: null, tokens }
  const read = ask.parse(text)
  for (const part of read.refused)
    deps.log(`[host] the model's ${part} is not one: ${JSON.stringify(text)}`)
  return { value: read.value, tokens }
}
