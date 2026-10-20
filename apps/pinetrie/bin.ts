#!/usr/bin/env node
// bin — `pinetrie <command>`: the plan (`command.ts`), carried out. Each
// command's module loads only when it is the one asked for, so `sign-in`
// loads no host.

import { readFile } from "node:fs/promises"
import path from "node:path"
import { thisInstall } from "@pinetrie/install"
import { COMMAND_USAGE, planCommand, refusedWords } from "./command.ts"

const planned = planCommand(process.argv.slice(2))
switch (planned.kind) {
  case "help":
    console.log(COMMAND_USAGE)
    break
  case "version": {
    const manifest = JSON.parse(
      await readFile(path.join(thisInstall.root, "package.json"), "utf8"),
    ) as { readonly version?: string }
    console.log(manifest.version ?? "unknown")
    break
  }
  case "refused":
    console.error(refusedWords(planned.named))
    process.exitCode = 2
    break
  case "run": {
    const { args } = planned
    switch (planned.command) {
      case "serve":
        await (await import("./host/serve-built.ts")).serveBuilt(args)
        break
      case "sign-in":
        process.exitCode = await (await import("./scripts/sign-in.ts")).main([
          "in",
          ...args,
        ])
        // pi's OAuth callback server closes without closing its connections,
        // and a browser's speculative one, which never sends a request, would
        // hold the process open. Exit once stdout drains, which on a macOS
        // pipe is asynchronous.
        process.stdout.write("", () => process.exit())
        break
      case "sign-out":
        process.exitCode = await (await import("./scripts/sign-in.ts")).main([
          "out",
          ...args,
        ])
        break
      case "tidy":
        process.exitCode = await (await import("./scripts/tidy.ts")).main(args)
        break
      case "session":
        process.exitCode = await (await import("./scripts/session.ts")).main(
          args,
        )
        break
    }
  }
}
