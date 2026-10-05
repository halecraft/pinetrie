// order — order keys: a field on each item that sorts a list by plain string
// comparison (S69), so two writers ordering one list never put an item in it
// twice. A lane's queue and pinned cards (`card.ts`) and the board's roots
// (`board.ts`) use them.

/**
 * Order keys are fixed-width base-36 integers, so string order is numeric
 * order. The first starts in the middle, and each next one a step on, which
 * leaves room before and between for reordering.
 */
const ORDER_WIDTH = 10
const ORDER_MAX = 36 ** ORDER_WIDTH - 1
const ORDER_START = 36 ** ORDER_WIDTH / 2
const ORDER_STEP = 2 ** 20

/** The key of `n`, kept within the width. */
export const orderKey = (n: number): string =>
  Math.min(Math.max(0, n), ORDER_MAX).toString(36).padStart(ORDER_WIDTH, "0")

const numberOf = (key: string): number => Number.parseInt(key, 36)

/** An order key after every key in `keys`; the first key when there is none. */
export function keyAfter(keys: Iterable<string>): string {
  let last = Number.NEGATIVE_INFINITY
  for (const key of keys) {
    const n = numberOf(key)
    if (Number.isFinite(n) && n > last) last = n
  }
  return orderKey(
    last === Number.NEGATIVE_INFINITY ? ORDER_START : last + ORDER_STEP,
  )
}

/** An order key after every card in `ordered`: a lane's queue, or every pinned card. */
export const orderAfter = (
  ordered: readonly { readonly place: { readonly order: string } }[],
): string => keyAfter(ordered.map(c => c.place.order))

/**
 * An order key between `before` and `after`, either null for an open end; null
 * when there is no room left between them, so the caller renumbers.
 */
export function orderBetween(
  before: string | null,
  after: string | null,
): string | null {
  const low = before === null ? -1 : numberOf(before)
  const high = after === null ? ORDER_MAX + 1 : numberOf(after)
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  if (before === null && after !== null)
    return high - ORDER_STEP > low
      ? orderKey(high - ORDER_STEP)
      : mid(low, high)
  if (after === null && before !== null)
    return low + ORDER_STEP < high ? orderKey(low + ORDER_STEP) : mid(low, high)
  return mid(low, high)
}

const mid = (low: number, high: number): string | null => {
  const m = Math.floor((low + high) / 2)
  return m > low && m < high ? orderKey(m) : null
}

/** `n` keys in order, a step apart from the start: a list renumbered. */
export const orderKeys = (n: number): readonly string[] =>
  Array.from({ length: n }, (_, i) => orderKey(ORDER_START + i * ORDER_STEP))
