// host/stalls — the host's event loop watched for stalls: a stretch in
// which it ran one thing and nothing else. Whatever the host awaits across a
// stall (a jj command, a lanehost call) is timed that much longer, so a slow
// command's line alone cannot tell a slow command from a stalled host. Each
// stall goes to every listener: the log's line, and the machine's sample.

import { monitorEventLoopDelay } from "node:perf_hooks"

/** A stall worth a line, in ms: the slow-command log's own threshold. */
const STALL_MS = 500

/**
 * How often Node's delay timer samples the loop. Each sample is the time
 * since the last one, so it holds the resolution as well as the delay.
 */
const RESOLUTION_MS = 20

/** How often the histogram is read. */
const CHECK_EVERY_MS = 1_000

/** What a check reads of Node's delay histogram, and how it clears it. */
export interface DelayHistogram {
  /** The longest sample since the last reset, in ns; 0 with none. */
  readonly max: number
  reset(): void
}

/**
 * The longest stall `maxNs` holds, in ms, when it reaches `thresholdMs`;
 * else null.
 */
export function stallToReport(input: {
  readonly maxNs: number
  readonly resolutionMs: number
  readonly thresholdMs: number
}): number | null {
  const stalled = input.maxNs / 1e6 - input.resolutionMs
  return stalled >= input.thresholdMs ? stalled : null
}

/**
 * Below this share of a stall spent on the CPU, the host was not busy but
 * stopped: the machine slept, or a synchronous call waited on the disk.
 */
const BUSY_SHARE = 0.1

/** A stall of the host's event loop, in ms, and how much of it was on the CPU. */
export interface Stall {
  readonly ms: number
  readonly cpuMs: number
}

/** A stall's line, worded from how long it was and how much of it was CPU. */
export function stallWords(stall: Stall): string {
  const ms = Math.round(stall.ms)
  const cpu = Math.round(stall.cpuMs)
  return stall.cpuMs < stall.ms * BUSY_SHARE
    ? `[host] the host was paused for ${ms} ms, ${cpu} ms of it on the CPU: the machine slept, or a synchronous call waited`
    : `[host] the event loop stalled for ${ms} ms, ${cpu} ms of it on the CPU: anything the host awaited meanwhile, a command among them, was timed that much longer`
}

/**
 * One check: a stall to every listener, and the histogram cleared after
 * it, once. Only after one: a reset drops the next sample, which spans the
 * reset, so a reset on every check would miss a stall that began just
 * after it; and the histogram has this one reader, so no listener can
 * clear what another has not heard. A stall not yet reported began after
 * the last check, since that check reported any before it, so `cpuMs`, the
 * CPU time since the last check, holds the stall's own.
 */
export function checkStalls(
  histogram: DelayHistogram,
  listeners: Iterable<(stall: Stall) => void>,
  cpuMs: number,
): void {
  const stalled = stallToReport({
    maxNs: histogram.max,
    resolutionMs: RESOLUTION_MS,
    thresholdMs: STALL_MS,
  })
  if (stalled === null) return
  const stall = { ms: stalled, cpuMs: Math.min(cpuMs, stalled) }
  for (const listener of listeners) listener(stall)
  histogram.reset()
}

/** The host's loop, watched: listen for its stalls, and stop. */
export interface StallWatch {
  /** Hears every stall from now on, until the returned function is called. */
  listen(listener: (stall: Stall) => void): () => void
  stop(): void
}

/**
 * The host's loop watched until `stop`. Node samples it from a native timer,
 * so the watch adds no JavaScript to the loop but one read a second. A stall
 * is heard at the first check after it ends: a check cannot run during one.
 */
export function watchStalls(): StallWatch {
  const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS })
  histogram.enable()
  const listeners = new Set<(stall: Stall) => void>()
  let cpu = process.cpuUsage()
  const timer = setInterval(() => {
    const since = process.cpuUsage(cpu)
    cpu = process.cpuUsage()
    checkStalls(histogram, listeners, (since.user + since.system) / 1_000)
  }, CHECK_EVERY_MS)
  timer.unref()
  return {
    listen(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stop() {
      clearInterval(timer)
      histogram.disable()
      listeners.clear()
    },
  }
}
