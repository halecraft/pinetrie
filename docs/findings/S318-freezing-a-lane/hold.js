// Holds MIB MiB in 4 KiB pages, each a quarter random and three quarters
// repeated text (compressible about as a heap is), and touches every page
// in passes, printing each pass's time in ms.
const MIB = Number(process.argv[2] ?? 1536)
const crypto = require("node:crypto")
const text = Buffer.from("{\"kind\":\"entry\",\"thread\":\"t-01a1\",\"text\":\"the quick brown fox \"}".repeat(64))
const pages = []
for (let i = 0; i < MIB * 256; i++) {
  const p = Buffer.allocUnsafe(4096)
  crypto.randomFillSync(p, 0, 1024)
  text.copy(p, 1024, 0, 3072)
  pages.push(p)
}
console.log("held")
let sum = 0
for (;;) {
  const s = process.hrtime.bigint()
  for (const p of pages) { p[0] = (p[0] + 1) & 255; sum += p[4095] }
  console.log(`pass ${Number(process.hrtime.bigint() - s) / 1e6} ms`)
}
