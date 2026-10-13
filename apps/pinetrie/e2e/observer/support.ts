// e2e/observer/support — the observer suite's guest: a QEMU machine booted
// on the lane VM's own kernel, with an initramfs of busybox, the loader and
// the workloads (`packages/lanehost/observer/suite`), built by the observer's
// Containerfile in the suites' Docker. QEMU emulates (a lane has no KVM),
// so its timings mean nothing.

import { execFile, execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  decodeLoaderLine,
  type LoaderLine,
  OBSERVER_CONTAINERFILE,
} from "@pinetrie/lanehost"
import { hostBytesRunner } from "@pinetrie/lanes"
import { buildVmImage } from "@pinetrie/vm"
import { cli, runtimeCli } from "../lane-runtime.ts"

const QEMU = "qemu-system-aarch64"
/** The guest's whole run, emulated: about 35 s on an M-series lane. */
const GUEST_TIMEOUT_MS = 15 * 60_000
/** Kept across runs: the VM image takes minutes to build. */
const CACHE = path.join(
  import.meta.dirname,
  "../../../../node_modules/.cache/pinetrie-observer-suite",
)

/** Why the guest cannot boot here, or null. */
export async function guestProblem(): Promise<string | null> {
  try {
    execFileSync(QEMU, ["--version"], { stdio: "pipe" })
  } catch {
    return `${QEMU} is not on PATH (apt-get install qemu-system-arm; brew install qemu)`
  }
  let arch: string
  try {
    arch = cli(["info", "--format", "{{.Architecture}}"]).trim()
  } catch (error) {
    return `the suites' Docker does not answer: ${String(error).split("\n")[0]}`
  }
  return arch === "aarch64"
    ? null
    : `the suites' Docker builds for ${arch}; the guest is the lane VM's arm64 kernel`
}

/** What the guest printed: the loader's lines, and what its cases left. */
export interface Guest {
  /** The main loader's lines, a 64 MiB ring. */
  readonly events: readonly LoaderLine[]
  /** The flood's loader's lines, a 16 KiB ring. */
  readonly flood: readonly LoaderLine[]
  /** `say`'s lines, each split at its tabs. */
  readonly expect: readonly (readonly string[])[]
  /** The console, whole, for a failure's detail. */
  readonly console: string
}

/** The console's lines between `=== <name>` and the next marker. */
export function section(console: string, name: string): readonly string[] {
  const lines = console.split("\n")
  const start = lines.indexOf(`=== ${name}`)
  if (start < 0) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => l.startsWith("=== "))
  return end < 0 ? rest : rest.slice(0, end)
}

const decoded = (lines: readonly string[]): readonly LoaderLine[] =>
  lines.flatMap(l => decodeLoaderLine(l) ?? [])

/** Builds the guest and the kernel (each cached), boots it, and reads its console. */
export async function bootGuest(log: (line: string) => void): Promise<Guest> {
  await mkdir(CACHE, { recursive: true })
  const tag = "pinetrie-observer-suite:local"
  log("building the observer's suite image")
  cli([
    "buildx",
    "build",
    "-q",
    "--load",
    "--target",
    "suite",
    "-t",
    tag,
    "-f",
    OBSERVER_CONTAINERFILE,
    path.dirname(OBSERVER_CONTAINERFILE),
  ])
  const initramfs = path.join(CACHE, "initramfs.cpio.gz")
  const [program = "docker", ...rest] = runtimeCli()
  await writeFile(
    initramfs,
    execFileSync(
      program,
      [...rest, "run", "--rm", tag, "cat", "/initramfs.cpio.gz"],
      {
        maxBuffer: 256 << 20,
      },
    ),
  )
  const vm = await buildVmImage({
    stateDir: CACHE,
    run: (image, argv) =>
      hostBytesRunner()([...runtimeCli(), "run", "--rm", image, ...argv]),
    log,
  })
  const out = path.join(CACHE, "console.txt")
  log(`booting ${QEMU} on ${vm.dir}/Image`)
  await new Promise<void>((resolve, reject) =>
    execFile(
      QEMU,
      [
        "-M",
        "virt",
        "-cpu",
        "max",
        "-smp",
        "2",
        "-m",
        "1536",
        "-kernel",
        path.join(vm.dir, "Image"),
        "-initrd",
        initramfs,
        "-append",
        "console=ttyAMA0 rdinit=/init quiet loglevel=1 panic=-1",
        "-display",
        "none",
        "-serial",
        `file:${out}`,
        "-monitor",
        "none",
        "-nic",
        "none",
        "-no-reboot",
      ],
      { timeout: GUEST_TIMEOUT_MS },
      error => (error === null ? resolve() : reject(error)),
    ),
  )
  const console = (await readFile(out, "utf8")).replace(/\r\n/g, "\n")
  return {
    events: decoded(section(console, "events")),
    flood: decoded(section(console, "flood")),
    expect: section(console, "expect").map(l => l.split("\t")),
    console,
  }
}
