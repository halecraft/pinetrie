// e2e/observer/support — the observer suite's guest: a QEMU machine booted
// on the lane VM's own kernel (the pinned `linux-virt`, unpacked), with an
// initramfs of busybox, the loader and the workloads
// (`packages/lanehost/observer/suite`), built by the observer's Containerfile
// in the suites' Docker. pine·trie's bash in it is the lanes' own, built by
// the default image's `bash` stage with core's `RUNTIME_BASH`, and given to
// the guest's build as a named context, so the machine role's sources stay
// untouched. QEMU emulates (a lane has no KVM), so its timings mean nothing.

import { execFile } from "node:child_process"
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { RUNTIME_BASH } from "@pinetrie/core"
import {
  decodeLoaderLine,
  type LoaderLine,
  OBSERVER_CONTAINERFILE,
} from "@pinetrie/lanehost"
import { statementsCommand } from "@pinetrie/shell/fixtures"
import { pinnedKernel, readBuilderPins } from "@pinetrie/vm"
import { command, commandBytes } from "../command.ts"
import { cli, runtimeCli } from "../lane-runtime.ts"

const QEMU = "qemu-system-aarch64"
/** The guest's whole run, emulated: about 35 s on an M-series lane. */
const GUEST_TIMEOUT_MS = 15 * 60_000
/** Kept across runs: the guest's image, and the kernel's package (39 MB). */
const CACHE = path.join(
  import.meta.dirname,
  "../../../../node_modules/.cache/pinetrie-observer-suite",
)
/** The default image's Containerfile, whose `bash` stage builds the lanes' bash. */
const LANES_CONTAINERFILE = path.join(
  import.meta.dirname,
  "../../../../packages/lanes/image/Containerfile",
)

/** Why QEMU cannot boot the guest here, or null. */
export async function qemuProblem(): Promise<string | null> {
  try {
    await command(QEMU, ["--version"])
    return null
  } catch {
    return `${QEMU} is not on PATH (apt-get install qemu-system-arm; brew install qemu)`
  }
}

/** Why the suites' Docker cannot build the guest's arm64 image, or null. */
export async function arm64DockerProblem(): Promise<string | null> {
  let arch: string
  try {
    arch = (await cli(["info", "--format", "{{.Architecture}}"])).trim()
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
  /** The output flood's loader's lines, a 256 KiB ring and a 16 KiB output ring. */
  readonly outputFlood: readonly LoaderLine[]
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

/** What the guest's build is given beside its own: pine·trie's bash, and the command it runs. */
async function guestContext(log: (line: string) => void): Promise<string> {
  const dir = path.join(CACHE, "guest")
  await rm(dir, { recursive: true, force: true })
  await mkdir(path.join(dir, "bin"), { recursive: true })
  const tag = "pinetrie-observer-suite-bash:local"
  log("building pine·trie's bash, the default image's stage")
  await cli([
    "buildx",
    "build",
    "-q",
    "--load",
    "--target",
    "bash",
    "--build-arg",
    `BASH_VERSION=${RUNTIME_BASH.version}`,
    "--build-arg",
    `BASH_PATCHES=${RUNTIME_BASH.patches}`,
    "-t",
    tag,
    "-f",
    LANES_CONTAINERFILE,
    path.dirname(LANES_CONTAINERFILE),
  ])
  const [program = "docker", ...rest] = runtimeCli()
  const bash = path.join(dir, "bin", "bash-pt")
  await writeFile(
    bash,
    await commandBytes(program, [
      ...rest,
      "run",
      "--rm",
      tag,
      "cat",
      "/out/bash",
    ]),
  )
  await chmod(bash, 0o755)
  await writeFile(path.join(dir, "cmd.sh"), statementsCommand())
  return dir
}

/** Builds the guest and the kernel (each cached), boots it, and reads its console. */
export async function bootGuest(log: (line: string) => void): Promise<Guest> {
  await mkdir(CACHE, { recursive: true })
  const guest = await guestContext(log)
  const tag = "pinetrie-observer-suite:local"
  log("building the observer's suite image")
  await cli([
    "buildx",
    "build",
    "-q",
    "--load",
    "--target",
    "suite",
    "--build-context",
    `guest=${guest}`,
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
    await commandBytes(program, [
      ...rest,
      "run",
      "--rm",
      tag,
      "cat",
      "/initramfs.cpio.gz",
    ]),
  )
  const kernel = await pinnedKernel(CACHE, (await readBuilderPins()).kernel)
  const out = path.join(CACHE, "console.txt")
  log(`booting ${QEMU} on ${kernel}`)
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
        kernel,
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
    outputFlood: decoded(section(console, "oflood")),
    expect: section(console, "expect").map(l => l.split("\t")),
    console,
  }
}
