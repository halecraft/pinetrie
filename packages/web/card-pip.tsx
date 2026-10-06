// web/card-pip — the mark of an unsent card of yours (ADR-0048, step 2):
// on a tab, a rail dot or an Archive row (`cardMarks`). One element, so the
// browser suite finds every mark by `.card-pip`.

/** A small dot in your colour, which your avatar uses. */
export function CardPip({ color }: { color: string }) {
  return (
    <span
      aria-label="your unsent card"
      className="card-pip"
      role="img"
      style={{ background: color }}
      title="your unsent card is here"
    />
  )
}
