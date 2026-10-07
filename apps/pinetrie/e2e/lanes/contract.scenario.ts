// e2e/lanes/contract — `container` does not promise that a clone written into
// a volume it made works, so every upgrade reruns a small soak.

import { execFile, execFileSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createVolume, describeFailure, run } from "@pinetrie/lanes"
import type { Checks } from "../checks.ts"
import { containerProblem, waitFor } from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import { ensureFsckImage, FSCK_IMAGE, sh } from "./support.ts"

export const scenario: Scenario = {
  needs: containerProblem,
  run: ({ check }) => contractSection(check),
}

/** Clones the contract checks. */
const CLONES = 20

async function contractSection(check: Checks["check"]): Promise<void> {
  const status = JSON.parse(sh("container system status --format json")) as {
    paths: { appRoot: string }
  }
  const volume = `pinetrie-contract-${process.pid}`
  const image = path.join(status.paths.appRoot, "volumes", volume, "volume.img")
  const probe = realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-soak-")))
  const clones = path.join(probe, "clones")
  sh(`mkdir -p ${clones}`)
  // Appends fsynced records, and churns files, until the host says stop.
  writeFileSync(
    path.join(probe, "writer.js"),
    `const fs = require("fs"), crypto = require("crypto")
const fd = fs.openSync("/workspace/log.bin", "a")
let n = 0
while (!fs.existsSync("/probe/stop")) {
  fs.writeSync(fd, "rec " + String(n).padStart(8, "0") + " " + "x".repeat(40) + "\\n")
  fs.fsyncSync(fd)
  n++
  fs.writeFileSync("/probe/fsynced", String(n))
  if (n % 20 === 0) fs.writeFileSync("/workspace/churn-" + (n % 7), crypto.randomBytes(40000))
}
`,
  )
  // One clone: replay the journal, check, and compare the records with what
  // was fsynced before the clone was taken. One line per clone.
  writeFileSync(
    path.join(probe, "check-one.sh"),
    `img=$1; n=$2; w=/tmp/w-$img; mkdir -p $w
cd /clones
e2fsck -fy "$img" > $w/fsck1 2>&1
e2fsck -fn "$img" > $w/fsck2 2>&1; clean=$?
repairs=$(awk 'NF { if ($0 ~ /\\? yes$/) { d = ($0 ~ /^[A-Za-z ]+\\? yes$/) ? prev : $0; print d } prev = $0 }' $w/fsck1 | grep -cvE '^Free (blocks|inodes) count wrong')
debugfs -R "dump /log.bin $w/log.bin" "$img" >/dev/null 2>&1
bad=$(head -n "$n" $w/log.bin | awk '!/^rec [0-9]{8} x{40}$/ { b++ } END { print b + 0 }')
have=$(wc -l < $w/log.bin)
echo "$img repairs=$repairs clean=$clean promised=$n have=$have bad=$bad"
rm -rf $w
`,
  )
  ensureFsckImage()
  // Small, so each check is quick: `e2fsck -f` walks every block group of a
  // volume, however little it holds. The journal is what is under test.
  const [program = "", ...args] = createVolume(volume, "4G")
  const created = await run(program, args)
  if (!created.ok)
    throw new Error(describeFailure("creating the volume", created))
  const writer = `pinetrie-contract-writer-${process.pid}`
  const fsynced = () =>
    Number(
      existsSync(path.join(probe, "fsynced"))
        ? readFileSync(path.join(probe, "fsynced"), "utf8").trim()
        : "0",
    )
  try {
    const t0 = Date.now()
    sh(
      `container run -d --init --name ${writer} -m 1G -v ${volume}:/workspace --mount type=bind,source=${probe},target=/probe docker.io/library/node:24-trixie-slim sleep infinity >/dev/null`,
    )
    const writing = new Promise<void>((resolve, reject) => {
      execFile(
        "container",
        ["exec", writer, "node", "/probe/writer.js"],
        error => (error === null ? resolve() : reject(error)),
      )
    })
    // Clones start once the writer is under way, and are taken back to back
    // with short random gaps while it writes (S41's soak, in small).
    await waitFor(() => fsynced() >= 100, 30_000)
    const t1 = Date.now()
    const promised: string[] = []
    for (let i = 0; i < CLONES; i++) {
      const count = fsynced()
      execFileSync("/bin/cp", ["-c", image, path.join(clones, `c${i}.img`)])
      promised.push(`c${i}.img ${count}`)
      await new Promise(r => setTimeout(r, 50 + Math.random() * 150))
    }
    writeFileSync(path.join(probe, "stop"), "")
    await writing
    const t2 = Date.now()
    writeFileSync(path.join(clones, "promised"), `${promised.join("\n")}\n`)
    const checked = sh(
      `container run --rm -v ${clones}:/clones -v ${probe}:/probe ${FSCK_IMAGE} sh -c 'xargs -n 2 -P 4 sh /probe/check-one.sh < /clones/promised'`,
    )
    const t3 = Date.now()
    console.log(
      `  (contract: writer up in ${((t1 - t0) / 1000).toFixed(1)} s, ${CLONES} clones in ${((t2 - t1) / 1000).toFixed(1)} s, checked in ${((t3 - t2) / 1000).toFixed(1)} s)`,
    )
    const rows = checked.trim().split("\n")
    const good = rows.filter(row => {
      const f = Object.fromEntries(
        row
          .split(" ")
          .slice(1)
          .map(kv => kv.split("=")),
      ) as Record<string, string>
      return (
        f.repairs === "0" &&
        f.clean === "0" &&
        f.bad === "0" &&
        Number(f.have) >= Number(f.promised)
      )
    })
    check(
      "every clone of a journaled volume taken mid-write checks clean and holds every fsynced record",
      rows.length === CLONES && good.length === CLONES,
      `${good.length} of ${rows.length}`,
    )
    if (good.length !== rows.length)
      console.log(rows.filter(r => !good.includes(r)).join("\n"))
  } finally {
    sh(`container rm -f ${writer} >/dev/null 2>&1 || true`)
    sh(`container volume rm ${volume} >/dev/null 2>&1 || true`)
    rmSync(probe, { recursive: true, force: true })
  }
}
