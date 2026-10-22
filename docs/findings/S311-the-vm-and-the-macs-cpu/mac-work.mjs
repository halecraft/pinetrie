// A fixed amount of CPU work on the Mac: 16 threads, each hashing the same
// number of times. Prints the wall time it took.
import { Worker, isMainThread } from "node:worker_threads"
import { createHash } from "node:crypto"
if (isMainThread) {
  const t0 = performance.now()
  await Promise.all(Array.from({ length: 16 }, () => new Promise(r => new Worker(new URL(import.meta.url)).on("exit", r))))
  console.log(`mac work: ${((performance.now() - t0) / 1000).toFixed(2)} s`)
} else {
  let h = Buffer.alloc(32)
  for (let i = 0; i < 1_500_000; i++) h = createHash("sha256").update(h).digest()
}
