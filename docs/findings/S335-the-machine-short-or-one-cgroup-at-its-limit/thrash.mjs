// Load A: one process thrashing at its own cgroup's memory.max, as the
// observer did: an anonymous working set that leaves its limit little room,
// and a file working set (its code, and FILE_MB of files read over and
// over) larger than that room. Prints its passes over the files at its end.
// Each file is read whole, unless `chunked`: then through one 1 MiB buffer,
// so its anonymous memory stays near what it holds.
//   node thrash.mjs <seconds> <anon MiB> <file MiB> [whole|chunked]
import { createHash } from "node:crypto"
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs"
import { deflateSync } from "node:zlib"

const [T = 300, ANON = 440, FILE = 128] = process.argv.slice(2, 5).map(Number)
const chunked = process.argv[5] === "chunked"
const chunk = Buffer.alloc(1 << 20)
const readChunked = path => {
  const fd = openSync(path, "r")
  while (readSync(fd, chunk, 0, chunk.length, null) > 0);
  closeSync(fd)
  return chunk
}
mkdirSync("/work", { recursive: true })
for (let i = 0; i < FILE / 16; i++) {
  const b = Buffer.alloc(16 << 20)
  for (let j = 0; j < b.length; j += 4096) b.writeUInt32LE((Math.random() * 2 ** 32) >>> 0, j)
  writeFileSync(`/work/f${i}`, b)
}
const held = []
for (let i = 0; i < ANON / 16; i++) held.push(Buffer.alloc(16 << 20).fill(i + 1))
console.log(`held ${ANON} MiB anonymous, ${FILE} MiB of files`)
const end = Date.now() + T * 1000
let passes = 0
while (Date.now() < end) {
  for (const f of readdirSync("/work")) {
    if (Date.now() > end) break
    const b = chunked ? readChunked(`/work/${f}`) : readFileSync(`/work/${f}`)
    createHash("sha256").update(b.subarray(0, 1 << 16)).digest("hex")
    deflateSync(b.subarray(0, 1 << 14))
    JSON.parse(JSON.stringify({ f, n: passes, s: b.subarray(0, 256).toString("base64") }))
  }
  passes++
}
console.log(`passes ${passes} held ${held.length}`)
