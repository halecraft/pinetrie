// e2e/lanes/package — the npm package as a person gets it: built
// (`scripts/package.ts`), packed, and installed by npm into an empty
// project, the layout that puts its dependencies beside it rather than
// inside. Its own `pinetrie serve` loads the pi-anthropic-auth it ships,
// draws the page and gets lanes ready, and a lane started from it runs its
// bundled helper and lanehost's scripts.
// The scripted model is the suites', so that lane is started by the suite's
// host over the installed package's files.

import { type ChildProcess, spawn } from "node:child_process"
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { PRODUCT_NAME, ROOT } from "@pinetrie/core"
import { laneMachine, planStartSteps } from "../../host/start-checklist.ts"
import { startStepWords } from "../../host/startup-lines.ts"
import type { Checks } from "../checks.ts"
import { command } from "../command.ts"
import { committedProject, join, START_AGENT, waitFor } from "../harness.ts"
import type { LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => packageSection(check, lanes),
}

const REPO = path.join(import.meta.dirname, "../../../..")

async function packageSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  // ── built, packed, installed ──
  await command("node", ["scripts/package.ts"], { cwd: REPO })
  const packed = mkdtempSync(path.join(tmpdir(), "pinetrie-packed-"))
  const tarball = path.join(
    packed,
    (
      await command(
        "npm",
        ["pack", path.join(REPO, "dist", "pinetrie"), "--silent"],
        { cwd: packed },
      )
    ).trim(),
  )
  const consumer = mkdtempSync(path.join(tmpdir(), "pinetrie-consumer-"))
  // Lanes mount the install from here, and a rootless Docker binds it as
  // another user: `mkdtemp` makes it private.
  chmodSync(consumer, 0o755)
  writeFileSync(path.join(consumer, "package.json"), '{ "private": true }\n')
  await command("npm", ["install", "--no-audit", "--no-fund", tarball], {
    cwd: consumer,
  })
  const installed = path.join(consumer, "node_modules", "pinetrie")

  // ── its own `pinetrie serve` ──
  const project = await committedProject("pinetrie-installed-", {
    "a.txt": "a\n",
  })
  const home = mkdtempSync(path.join(tmpdir(), "pinetrie-installed-home-"))
  // Its session's lane runtime is under it, which lanehost mounts.
  chmodSync(home, 0o755)
  const lines: string[] = []
  const serving: ChildProcess = spawn(
    path.join(consumer, "node_modules", ".bin", "pinetrie"),
    ["serve"],
    {
      cwd: project,
      env: {
        ...process.env,
        // Nothing of the person's: config, data, ssh. Docker's CLI keeps its
        // own config, where its plugins may be.
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, "config"),
        XDG_DATA_HOME: path.join(home, "data"),
        DOCKER_CONFIG:
          process.env.DOCKER_CONFIG ?? path.join(homedir(), ".docker"),
        SSH_AUTH_SOCK: "",
        PINETRIE_PORT: "0",
        // `serve` reads its folder from `INIT_CWD`, which pnpm set to the
        // repo for this suite; npm and pnpm set it to where a person ran it.
        INIT_CWD: project,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const heard = (b: Buffer) => lines.push(...b.toString().split("\n"))
  serving.stdout?.on("data", heard)
  serving.stderr?.on("data", heard)
  let exited = false
  const gone = new Promise(resolve =>
    serving.once("exit", () => {
      exited = true
      resolve(undefined)
    }),
  )
  try {
    await waitFor(
      () => exited || lines.some(l => l.includes("[host] listening")),
      60_000,
    )
    // Its host is configured with no model, so it loads the shipped copy.
    check(
      "the installed pinetrie loads the pi-anthropic-auth it ships",
      lines.some(
        l =>
          l.startsWith("[host] anthropic") &&
          l.includes(`shipped with ${PRODUCT_NAME}`),
      ),
      lines.filter(l => l.includes("anthropic")).join(" | "),
    )
    const url = /listening\s+(\S+)/.exec(
      lines.find(l => l.includes("[host] listening")) ?? "",
    )?.[1]
    const index = url === undefined ? null : await fetch(url)
    const html = (await index?.text()) ?? ""
    const asset = /src="\/?(assets\/[^"]+\.js)"/.exec(html)?.[1]
    const script =
      url === undefined || asset === undefined
        ? null
        : await fetch(new URL(asset, url))
    check(
      "the installed pinetrie serves the folder it starts in, its page built",
      lines.some(l => l.includes(`[host] project     ${project}`)) &&
        index?.status === 200 &&
        script?.status === 200,
      `${index?.status} ${asset} ${script?.status}`,
    )

    const person =
      url === undefined
        ? null
        : await join(
            { wsUrl: `${url.replace(/^http/, "ws")}ws` },
            "ada",
            "package",
          ).catch(() => null)
    check("a person joins the installed pinetrie", person !== null)
    await person?.close()

    // A host listens only once its lanes work, each step ended in order.
    const machine = laneMachine(process.platform)
    const ends = lines.filter(l => l.startsWith("[host] ✓ "))
    check(
      "the installed pinetrie gets lanes of their own ready",
      !exited &&
        planStartSteps({ tools: true }).every((step, i) =>
          ends[i]?.startsWith(`[host] ✓ ${startStepWords(step, machine)}`),
        ),
      ends.join(" | "),
    )
  } finally {
    serving.kill("SIGTERM")
    await gone
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }

  // ── a lane run from the installed package ──
  const h = await lanes.sectionHost({
    files: { "b.txt": "b\n" },
    install: { root: installed, form: "built" },
  })
  try {
    h.script.use([
      { tool: "bash", args: { command: "echo FROM-THE-PACKAGE" } },
      { text: "ran it" },
    ])
    await h.user.send("@agent run it", ROOT, START_AGENT)
    const ran = (await h.results("ran it")).at(-1) ?? ""
    const helper = readFileSync(
      path.join(installed, "packages/pi/lane-helper.js"),
      "utf8",
    )
    check(
      "a lane runs its command through the installed package's bundled helper",
      ran.includes("FROM-THE-PACKAGE") && !helper.includes('from "./'),
      ran.slice(0, 120),
    )
  } finally {
    await h.close()
    rmSync(consumer, { recursive: true, force: true })
    rmSync(packed, { recursive: true, force: true })
  }
}
