// web/use-stable — a handler whose identity never changes.

import { useCallback, useLayoutEffect, useRef } from "react"

/**
 * A function of fixed identity that calls the latest `fn`, so a memoised child
 * given it is not redrawn when `fn` closes over new values. For event handlers
 * only: called during render, it runs the previous render's `fn`. React's
 * `useEffectEvent` has the same shape but may not be passed to a child.
 */
export function useStable<A extends readonly unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const latest = useRef(fn)
  useLayoutEffect(() => {
    latest.current = fn
  })
  return useCallback((...args: A) => latest.current(...args), [])
}
