// web/popover — a trigger button and the box it opens: every menu
// (`menu.tsx`).
//
// The box is shown in the top layer (`popover="manual"`), which is above
// every stacking context and clipping container on the page: drawn inside
// `.column-head`, which isolates for its banner's blend, it would be under
// the column's messages. It is placed from the trigger's rect when it opens
// (`placeBox`), so it would drift from its trigger on a scroll that moves
// the trigger or a resize: either closes it, as do Escape and a click
// elsewhere. Only a scroll of an element holding the trigger moves it: a
// column following its end scrolls as entries arrive, and must not close a
// menu elsewhere. `manual` leaves all closing to this file.
//
// Nothing else closes it, so a trigger drawn from live data that has gone
// (`gone`) stays while its box is open, and leaves when the person closes it.

import { type BoxPlacement, placeBox } from "@pinetrie/web-core"
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { Button } from "./button.tsx"

interface PopoverApi {
  /** Close the box, and give the trigger focus back if `refocus`. */
  readonly close: (refocus: boolean) => void
  /** The heading's id, for whatever the heading names; none without one. */
  readonly headingId: string | undefined
}

/**
 * What else the trigger carries, when it is more than a menu's button: a folded
 * list's icon shows its root on a click and is dragged.
 */
export type TriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly [data: `data-${string}`]: string | undefined
}

export function Popover({
  className,
  trigger,
  triggerClassName,
  label,
  title,
  role,
  id,
  boxClassName,
  lead,
  heading,
  onOpen,
  onToggle,
  gone = false,
  opensOn = "click",
  triggerProps = {},
  children,
}: {
  /** The wrapper's class; `open` is added while the box is open. */
  className: string
  /** What the trigger button shows. */
  trigger: ReactNode
  triggerClassName: string
  /** The trigger's accessible name. */
  label: string
  title?: string
  /**
   * The trigger's `aria-haspopup`. A dialog's box takes the role; a menu's
   * role belongs to its list, which may hold only menu items.
   */
  role: "menu" | "dialog"
  /** The box's id; one is made when none is given. */
  id?: string
  boxClassName: string
  /** Drawn at the top of the box, before the heading: never a control. */
  lead?: ReactNode
  /** Drawn at the top of the box. */
  heading?: string
  /** Called each time the box is drawn anew: where focus goes. */
  onOpen: (box: HTMLElement) => void
  /** Called when the box opens or closes, and once, closed, when mounted. */
  onToggle?: (open: boolean) => void
  /**
   * What the trigger stood for has gone: it is not drawn, except while its
   * box is open, which stays until the person closes it.
   */
  gone?: boolean
  /**
   * What opens the box: a click, or a `contextmenu` event (a right-click,
   * Shift+F10 or the Menu key), leaving the click to `triggerProps`. With
   * `contextmenu`, ArrowDown is left to the trigger's list too.
   */
  opensOn?: "click" | "contextmenu"
  triggerProps?: TriggerProps
  children: (api: PopoverApi) => ReactNode
}) {
  const [at, setAt] = useState<BoxPlacement | null>(null)
  const open = at !== null
  const wrapper = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const ownId = useId()
  const boxId = id ?? ownId
  const headingId = useId()

  const show = () => {
    const r = button.current?.getBoundingClientRect()
    if (r === undefined) return
    setAt(placeBox(r, { width: window.innerWidth, height: window.innerHeight }))
  }
  const close = (refocus: boolean) => {
    setAt(null)
    if (refocus) button.current?.focus()
  }

  // StrictMode runs this twice, and `showPopover` throws on a box already
  // shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per opening, with that render's `onOpen`
  useLayoutEffect(() => {
    const el = box.current
    if (!open || el === null) return
    if (!el.matches(":popover-open")) el.showPopover()
    onOpen(el)
  }, [open])

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per opening and closing, with that render's `onToggle`
  useEffect(() => {
    onToggle?.(open)
  }, [open])

  // Closed by Escape, a click elsewhere, a scroll that moves the trigger, or a
  // resize. Escape counts from the trigger, the box, or nowhere: the item that
  // held focus can go from under it (the agent's row, when its work ends).
  useEffect(() => {
    if (!open) return
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const at = e.target
      if (
        at !== document.body &&
        !(at instanceof Node && wrapper.current?.contains(at))
      )
        return
      e.preventDefault()
      setAt(null)
      button.current?.focus()
    }
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && wrapper.current?.contains(e.target))
        return
      setAt(null)
    }
    // The page's own scroll has the document as its target, which holds it.
    const drift = (e: Event) => {
      const trigger = wrapper.current
      if (
        trigger !== null &&
        e.target instanceof Node &&
        e.target.contains(trigger)
      )
        setAt(null)
    }
    const shut = () => setAt(null)
    document.addEventListener("keydown", onEscape)
    document.addEventListener("pointerdown", outside, true)
    window.addEventListener("scroll", drift, true)
    window.addEventListener("resize", shut)
    return () => {
      document.removeEventListener("keydown", onEscape)
      document.removeEventListener("pointerdown", outside, true)
      window.removeEventListener("scroll", drift, true)
      window.removeEventListener("resize", shut)
    }
  }, [open])

  if (gone && !open) return null
  const named = heading === undefined ? undefined : headingId
  const boxProps = (at: BoxPlacement) => ({
    className: boxClassName,
    id: boxId,
    popover: "manual" as const,
    ref: box,
    style: at,
  })
  const body = (
    <>
      {lead}
      {heading !== undefined && (
        <p className="menu-heading" id={headingId}>
          {heading}
        </p>
      )}
      {children({ close, headingId: named })}
    </>
  )
  return (
    <span className={open ? `${className} open` : className} ref={wrapper}>
      <Button
        look="plain"
        {...triggerProps}
        aria-controls={open ? boxId : undefined}
        aria-expanded={open}
        aria-haspopup={role}
        aria-label={label}
        className={triggerClassName}
        onClick={
          opensOn === "click"
            ? () => (open ? close(false) : show())
            : triggerProps.onClick
        }
        onContextMenu={
          opensOn === "contextmenu"
            ? e => {
                e.preventDefault()
                if (open) close(false)
                else show()
              }
            : triggerProps.onContextMenu
        }
        onKeyDown={
          opensOn === "click"
            ? e => {
                if (e.key !== "ArrowDown" || open) return
                e.preventDefault()
                show()
              }
            : triggerProps.onKeyDown
        }
        ref={button}
        title={title}
      >
        {trigger}
      </Button>
      {at !== null &&
        (role === "dialog" ? (
          <div
            {...boxProps(at)}
            aria-label={named === undefined ? label : undefined}
            aria-labelledby={named}
            role="dialog"
          >
            {body}
          </div>
        ) : (
          // A menu's list takes the role, and its arrow keys (`menu.tsx`).
          <div {...boxProps(at)}>{body}</div>
        ))}
    </span>
  )
}
