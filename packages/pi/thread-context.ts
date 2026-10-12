// pi/thread-context — the thread a pi call is made in, carried in its
// `Context`. Every call that drives a lane carries its thread, and pi keeps
// it in every commit of the run, so the same value names the lane for its
// tools and the thread of every entry a commit writes (`threadOfEntries`).
// The scribe passes it for a thread with no lane.

import {
  createContextKey,
  withContextValue,
} from "@earendil-works/pi-agent-core/harness/context"
import type { ThreadId } from "@pinetrie/core"

type Context = Parameters<typeof withContextValue>[2]

const THREAD = createContextKey<ThreadId>("pinetrie.thread")

/**
 * `base` with `thread` named: pass it to every call that drives the thread's
 * lane, and to the scribe's commits in it. Every entry a commit under it
 * writes is that thread's (`threadOfEntries`).
 */
export const threadContext = (thread: ThreadId, base: Context): Context =>
  withContextValue(THREAD, thread, base)

/** The thread a `Context` was given, if any: a lane's is its thread's. */
export const threadOfContext = (context: Context): ThreadId | undefined =>
  context.value(THREAD)
