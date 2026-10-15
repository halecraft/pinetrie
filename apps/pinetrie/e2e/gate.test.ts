import { execFileSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { expect, test } from "vitest"
import { gateClose, gateCommand, gateFeed, newGate } from "./gate.ts"

/** Run a gate's command in a local bash, as a lane's bash tool would, and collect what it prints. */
const running = (command: string) => {
  const child = spawn("bash", ["-c", command])
  let out = ""
  child.stdout.on("data", (b: Buffer) => {
    out += b.toString()
  })
  const ended = new Promise<number | null>(resolve =>
    child.on("close", code => resolve(code)),
  )
  return { printed: () => out, ended }
}

const run = (script: string) => execFileSync("sh", ["-c", script])

test("a gate prints only what it is fed, each line as written, and ends when closed", async () => {
  const gate = newGate("test")
  const command = running(gateCommand(gate))
  const awkward = [`it's "quoted"`, "$HOME and `ticks`", "back\\slash", "-n"]
  run(gateFeed(gate, ["one"]))
  await expect.poll(command.printed).toBe("one\n")
  run(gateFeed(gate, awkward))
  await expect.poll(command.printed).toBe(`one\n${awkward.join("\n")}\n`)
  run(gateClose(gate))
  expect(await command.ended).toBe(0)
  expect(command.printed()).toBe(`one\n${awkward.join("\n")}\n`)
  run(`rm -f '${gate.fifo}'`)
})

test("a feed whose gate never made its FIFO fails, and leaves no file there", () => {
  const gate = newGate("never")
  expect(() => run(gateFeed(gate, ["lost"], 2))).toThrow()
  expect(existsSync(gate.fifo)).toBe(false)
})

test("two gates never share a FIFO", () => {
  expect(newGate("same").fifo).not.toBe(newGate("same").fifo)
})
