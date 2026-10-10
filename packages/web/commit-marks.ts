/// <reference types="vite/client" />
// web/commit-marks — a user-timing mark each time a component commits, in
// the development build only: what the browser suite counts a list's redraws
// by (`componentRenders`, `apps/pinetrie/e2e/browser/page.ts`). React's own
// render measures skip a render whose props are new objects holding the same
// data, which is the redraw a memo exists to prevent. No React here: the
// suite imports the prefix.

/** What each mark's name starts with; the component's name follows. */
export const COMMIT_MARK = "pinetrie-commit:"

/**
 * Mark that `name` committed. Called from an effect with no dependency list,
 * which runs once per commit of that component: not for an update inside it,
 * nor a render React threw away.
 */
export function markCommit(name: string): void {
  if (import.meta.env.DEV) performance.mark(`${COMMIT_MARK}${name}`)
}
