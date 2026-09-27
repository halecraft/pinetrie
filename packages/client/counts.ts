// client/counts — how a count and a list of names read. Pure.

/** "1 message", "6 messages": a noun whose plural adds an s. */
export const plural = (n: number, noun: string): string =>
  `${n} ${noun}${n === 1 ? "" : "s"}`

const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" })

/** "Ada", "Ada and Bea", "Ada, Bea, and Cat". */
export const listOf = (items: readonly string[]): string => names.format(items)
