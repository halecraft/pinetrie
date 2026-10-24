// e2e/suite-facts — why each suite requirement is not met here, or null:
// what a suite's runner asks once per requirement a chosen scenario names
// (`runSuite`). The lanes', Playwright's and the observer's probes are
// imported only when asked: a suite that needs no browser loads no
// Playwright.

import { existsSync } from "node:fs"
import os, { homedir } from "node:os"
import { configPlaces } from "@pinetrie/config"
import { NESTED_MOUNT } from "@pinetrie/docker"
import { providerCredential } from "@pinetrie/pi"
import { vmHostRefusal, vmWords } from "@pinetrie/vm"
import type { SuiteRequirement } from "./requirements.ts"

/** The provider `e2e:live`'s model is from (`live.scenario.ts`). */
export const LIVE_PROVIDER = "cerebras"

/** Why `r` is not met here, or null. */
export async function suiteFact(r: SuiteRequirement): Promise<string | null> {
  switch (r) {
    case "lane-runtime":
      return (await import("./lane-hosts.ts")).runtimeProblem()
    case "lane-vm": {
      const host = vmHostRefusal({
        platform: process.platform,
        arch: process.arch,
        darwin: Number(os.release().split(".")[0]),
      })
      return host === null ? null : vmWords(host)
    }
    case "rootful-docker":
      return existsSync(NESTED_MOUNT)
        ? "this is a lane's rootless Docker"
        : null
    case "live-model": {
      if (process.env.PINETRIE_LIVE !== "1")
        return "not asked for: PINETRIE_LIVE=1 (pnpm run e2e:live)"
      const places = configPlaces(process.env, homedir(), null)
      const found = await providerCredential(places, LIVE_PROVIDER)
      return found === null
        ? `no ${LIVE_PROVIDER} credential: pnpm sign-in ${LIVE_PROVIDER}, or its key in the environment`
        : null
    }
    case "chromium":
      return (await import("./browser/page.ts")).chromiumProblem()
    case "qemu":
      return (await import("./observer/support.ts")).qemuProblem()
    case "arm64-docker":
      return (await import("./observer/support.ts")).arm64DockerProblem()
  }
}
