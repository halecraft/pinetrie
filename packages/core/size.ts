// core/size — a size as people and Docker write it: the one parser, so a
// size means one thing in `pinetrie.json` and in a container's limit.

/** A unit's power of 1024: the letter alone or with `iB`, in any case. */
const UNITS = "kmgt"

/**
 * `text` in bytes: a whole number of bytes, or a number and a unit (`K`,
 * `M`, `G`, `T`, alone or with `iB`, in any case), binary as Docker reads
 * them; null for anything else. A unit with a bare `B` (`GB`, `gb`) is
 * refused, since people read it as decimal and Docker as binary.
 */
export function parseSize(text: string): number | null {
  const found = /^(\d+(?:\.\d+)?)\s*(?:([kmgt])(?:ib)?)?$/i.exec(text.trim())
  if (found === null) return null
  const [, amount = "", unit] = found
  if (unit === undefined)
    return Number.isInteger(Number(amount)) ? Number(amount) : null
  return Math.floor(
    Number(amount) * 1024 ** (UNITS.indexOf(unit.toLowerCase()) + 1),
  )
}
