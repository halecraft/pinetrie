// web/button — every button the page draws. Its look is a value, drawn by the
// stylesheet's `[data-look]` rules under every rule of the button's own
// (`index.html`, "Buttons"); `button.test.ts` holds every `<button>` here.

import type { ButtonHTMLAttributes, Ref } from "react"

/** How a button is drawn: filled in the action's blue, outlined, or clear. */
export type ButtonLook = "primary" | "outline" | "plain"

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly look: ButtonLook
  readonly ref?: Ref<HTMLButtonElement>
}

/** A button: `type` is `button` unless given, so none submits a form by accident. */
export function Button({ look, type = "button", ...rest }: ButtonProps) {
  return <button {...rest} data-look={look} type={type} />
}

/**
 * A button that shows only a glyph or an icon, clear unless given a look.
 * `label` is its name, read aloud in the glyph's place.
 */
export function IconButton({
  label,
  look = "plain",
  ...rest
}: Omit<ButtonProps, "look" | "aria-label"> & {
  readonly label: string
  readonly look?: ButtonLook
}) {
  return <Button {...rest} aria-label={label} look={look} />
}
