// pnpm sign-in [provider] [oauth|api-key], pnpm sign-out <provider> — a
// provider's credential, kept in pine·trie's `auth.json`
// (`$XDG_DATA_HOME/pinetrie`). pi's own sign-in runs: a subscription's in a
// browser, from the URL printed here, pasting the code or the URL it lands on
// when the redirect cannot reach this machine; an API key typed, hidden.
// Providers come from pi and from the packages pine·trie's config lists.

import { homedir } from "node:os"
import { createInterface } from "node:readline/promises"
import { Writable } from "node:stream"
import { configPlaces, readStartLayers } from "@pinetrie/config"
import {
  bindAgentDir,
  planSignIn,
  providerAuth,
  type SignInInteraction,
  type SignInProvider,
  signInNoticeLines,
} from "@pinetrie/pi"
import { SETTINGS, settleHost } from "../host/settings.ts"
import { homePath } from "../host/startup-lines.ts"

const [verb, ...args] = process.argv.slice(2)
const env = process.env
const places = configPlaces(env, homedir(), null)
// Packages admit only the machine's and your own file, so no project is read.
const settled = settleHost(await readStartLayers(SETTINGS, places, env), {})
const auth = await providerAuth({
  places: {
    configDir: places.dirs.config,
    credentials: places.credentials,
    models: places.models,
  },
  binding: bindAgentDir(places.dirs.config),
  packages: settled.settled.packages.value,
})

/** A terminal that echoes typed text, or hides it. */
let hidden = false
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!hidden) process.stdout.write(chunk)
    done()
  },
})
const terminal = createInterface({
  input: process.stdin,
  output,
  terminal: true,
})

// readline redraws its prompt by clearing the line first, which would erase a
// question written around it; a secret's question is written directly, since
// hidden output keeps that clear from reaching the terminal.
const ask = async (question: string, secret = false): Promise<string> => {
  if (secret) process.stdout.write(question)
  hidden = secret
  try {
    return (await terminal.question(secret ? "" : question)).trim()
  } finally {
    hidden = false
    if (secret) process.stdout.write("\n")
  }
}

const interaction: SignInInteraction = {
  async prompt(p) {
    if (p.kind !== "select") return ask(`${p.message} `, p.kind === "secret")
    p.options.forEach((o, i) => {
      console.log(`  ${i + 1}. ${o.label}`)
    })
    const picked = Number.parseInt(await ask(`${p.message} `), 10)
    const option = p.options[picked - 1]
    if (option === undefined) throw new Error("no such option")
    return option.id
  },
  notify(notice) {
    for (const line of signInNoticeLines(notice)) console.log(line)
  },
}

const listed = (providers: readonly SignInProvider[]) => {
  for (const p of providers.filter(p => p.methods.length > 0))
    console.log(
      `  ${p.id.padEnd(24)} ${p.methods.join(", ").padEnd(16)} ${p.credential === null ? "" : `signed in (${p.credential})`}`,
    )
}

try {
  const providers = auth.providers()
  if (verb === "out") {
    const [named] = args
    const provider = providers.find(p => p.id === named)
    if (provider === undefined) {
      console.log("pnpm sign-out <provider>, one of:")
      listed(providers.filter(p => p.credential !== null))
      process.exitCode = 2
    } else {
      await auth.signOut(provider.id)
      console.log(
        `Signed out of ${provider.name}. A key in an environment variable or models.json is unchanged.`,
      )
    }
  } else {
    const planned = planSignIn(providers, args)
    switch (planned.kind) {
      case "list":
      case "unknown":
        if (planned.kind === "unknown")
          console.log(`No provider is named ${planned.named}.`)
        console.log("pnpm sign-in <provider> [oauth|api-key], one of:")
        listed(providers)
        process.exitCode = planned.kind === "unknown" ? 2 : 0
        break
      case "choose":
      case "sign-in": {
        const method =
          planned.kind === "sign-in"
            ? planned.method
            : (await ask(
                  `${planned.provider.name}: sign in with ${planned.provider.oauthName ?? "an account"} (1) or an API key (2)? `,
                )) === "2"
              ? "api_key"
              : "oauth"
        await auth.signIn(planned.provider.id, method, interaction)
        console.log(
          `Signed in to ${planned.provider.name}. The credential is in ${homePath(places.credentials, homedir())}.`,
        )
        break
      }
    }
  }
} finally {
  terminal.close()
}
