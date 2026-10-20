// web/page — the frame of a page over the stage: a back button and the page's
// title, then its body in a column of readable width. `App` draws it in the
// stage's grid cell, over the stage, which stays laid out and inert beneath it
// (`packages/web/TECHNICAL.md`, "Pages").

import { type PageName, pageWords } from "@pinetrie/interface"
import { type ReactNode, useLayoutEffect, useRef } from "react"
import { Button } from "./button.tsx"

export function Page({
  page,
  onBack,
  children,
}: {
  page: PageName
  onBack: () => void
  children: ReactNode
}) {
  const words = pageWords(page)
  const heading = useRef<HTMLHeadingElement>(null)
  // A page opened from a menu would leave focus on the menu's gone item.
  useLayoutEffect(() => heading.current?.focus(), [])
  return (
    <section aria-labelledby={`page-${page}`} className="page" data-page={page}>
      <header className="page-head">
        <Button look="outline" className="page-back" onClick={onBack}>
          {words.back}
        </Button>
        <h1 id={`page-${page}`} ref={heading} tabIndex={-1}>
          {words.title}
        </h1>
      </header>
      <div className="page-body">{children}</div>
    </section>
  )
}
