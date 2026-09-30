// client/use-fetched — fetch a list of URLs whose answers never change
// (ADR-0047): a review's URL names a commit, so the URL is the whole cache
// key, and the browser's HTTP cache answers one seen before.

import { useEffect, useRef, useState } from "react"
import type { Loaded } from "./review.ts"

const LOADING: Loaded<never> = { kind: "loading" }

/**
 * Each URL's answer, in the URLs' order. There is no refetch rule: a URL is
 * fetched once while it is listed, and a fetch whose URL leaves the list, or
 * the component, is aborted. `read` turns an OK response into its value, and
 * may throw; any other status is `failed` with it.
 */
export function useFetched<T>(
  urls: readonly string[],
  read: (response: Response) => Promise<T>,
): readonly Loaded<T>[] {
  const [got, setGot] = useState<ReadonlyMap<string, Loaded<T>>>(new Map())
  const known = useRef(got)
  known.current = got
  const reader = useRef(read)
  reader.current = read
  // By value: callers build a new array on every render.
  const key = urls.join("\n")
  useEffect(() => {
    const listed = key === "" ? [] : key.split("\n")
    const controllers = listed.flatMap(url => {
      if ((known.current.get(url) ?? LOADING).kind !== "loading") return []
      const controller = new AbortController()
      const settle = (value: Loaded<T>) => {
        if (controller.signal.aborted) return
        setGot(before => {
          const after = new Map<string, Loaded<T>>()
          for (const u of listed) {
            const was = before.get(u)
            if (was !== undefined) after.set(u, was)
          }
          return after.set(url, value)
        })
      }
      fetch(url, { signal: controller.signal })
        .then(async response =>
          settle(
            response.ok
              ? { kind: "ready", value: await reader.current(response) }
              : {
                  kind: "failed",
                  status: response.status,
                  reason: await response.text(),
                },
          ),
        )
        .catch((error: unknown) =>
          settle({
            kind: "failed",
            status: 0,
            reason: error instanceof Error ? error.message : String(error),
          }),
        )
      return [controller]
    })
    return () => {
      for (const c of controllers) c.abort()
    }
  }, [key])
  return urls.map(url => got.get(url) ?? LOADING)
}
