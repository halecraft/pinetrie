// web-core/theme — the page light, dark, or as the system is set, kept per
// device. The system's choice leaves the root without `data-theme`, so the
// stylesheet's `color-scheme: light dark` follows the browser's preference;
// light or dark forces one (`packages/web/TECHNICAL.md`, "The page's colours").

import type { Codec } from "@pinetrie/interface"

export type Theme = "system" | "light" | "dark"

/** The choices, in the order the account menu offers them. */
export const THEMES: readonly Theme[] = ["system", "light", "dark"]

export const themeCodec: Codec<Theme> = {
  encode: theme => theme,
  decode: (raw: unknown) => THEMES.find(t => t === raw),
}

/** The root's `data-theme` for `theme`: none for the system's. */
export const themeAttribute = (theme: Theme): "light" | "dark" | null =>
  theme === "system" ? null : theme

/** The heading over the choices in the account menu. */
export const THEME_HEADING = "Theme"

/** A choice's label in the account menu. */
export function themeWords(theme: Theme): string {
  switch (theme) {
    case "system":
      return "As your system is set"
    case "light":
      return "Light"
    case "dark":
      return "Dark"
  }
}
