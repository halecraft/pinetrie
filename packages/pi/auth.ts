// pi/auth — signing in to a provider and out of it, through pi's model
// runtime over pine·trie's `auth.json`. The interaction is pine·trie's own
// shape, so no pi type crosses: a prompt asks for text, a secret, a pasted
// code or a choice; a notice gives a sign-in URL, a device code, progress or
// information. The terminal (`pnpm sign-in`) is one way to answer it.

import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { AgentDirBinding } from "./agent-dir.ts"
import { type ModelPlaces, registerProviders } from "./config.ts"
import { openLoader, openRuntime } from "./deep.ts"

export type SignInMethod = "oauth" | "api_key"

/** A provider pine·trie can sign in to, as the terminal or a page lists it. */
export interface SignInProvider {
  readonly id: string
  readonly name: string
  readonly methods: readonly SignInMethod[]
  /** Its OAuth method's name, e.g. "Anthropic (Claude Pro/Max)". */
  readonly oauthName: string | null
  /** Where its credential is, by pi's word (`stored`: `auth.json`); null with none. Never the credential. */
  readonly credential: string | null
}

export type SignInPrompt =
  | {
      readonly kind: "text" | "secret" | "manual-code"
      readonly message: string
      readonly placeholder: string | null
    }
  | {
      readonly kind: "select"
      readonly message: string
      readonly options: readonly {
        readonly id: string
        readonly label: string
      }[]
    }

export type SignInNotice =
  | {
      readonly kind: "info"
      readonly message: string
      readonly links: readonly string[]
    }
  | {
      readonly kind: "url"
      readonly url: string
      readonly instructions: string | null
    }
  | {
      readonly kind: "device-code"
      readonly code: string
      readonly url: string
    }
  | { readonly kind: "progress"; readonly message: string }

export interface SignInInteraction {
  /** The answer to `prompt`: what was typed, or a select's option id. Rejects to cancel. */
  prompt(prompt: SignInPrompt): Promise<string>
  notify(notice: SignInNotice): void
}

export interface ProviderAuth {
  providers(): readonly SignInProvider[]
  signIn(
    provider: string,
    method: SignInMethod,
    interaction: SignInInteraction,
  ): Promise<void>
  signOut(provider: string): Promise<void>
}

/**
 * Sign-in over pine·trie's `auth.json`, with the providers `packages`
 * register beside pi's own. Its directory is made private first: pi writes
 * the file itself, readable by its owner alone.
 */
export async function providerAuth(input: {
  readonly places: ModelPlaces
  readonly binding: AgentDirBinding
  /** Listed packages, by folder: their providers can be signed in to too. */
  readonly packages: readonly string[]
}): Promise<ProviderAuth> {
  const { places } = input
  await mkdir(path.dirname(places.credentials), {
    recursive: true,
    mode: 0o700,
  })
  const runtime = await openRuntime({
    authPath: places.credentials,
    modelsPath: places.models,
  })
  if (input.packages.length > 0) {
    const loader = await openLoader({
      cwd: places.configDir,
      agentDir: places.configDir,
      extensionPaths: input.packages,
      skillPaths: [],
      promptPaths: [],
      keepContextFile: () => false,
    })
    registerProviders(runtime, loader)
  }
  return {
    providers: () =>
      runtime.getProviders().map(p => {
        const status = runtime.getProviderAuthStatus(p.id)
        const methods: SignInMethod[] = [
          ...(p.auth.oauth === undefined ? [] : ["oauth" as const]),
          ...(p.auth.apiKey?.login === undefined ? [] : ["api_key" as const]),
        ]
        return {
          id: p.id,
          name: p.name,
          methods,
          oauthName: p.auth.oauth?.name ?? null,
          credential: status.configured
            ? (status.source ?? "configured")
            : null,
        }
      }),
    async signIn(provider, method, interaction) {
      await runtime.login(provider, method, {
        prompt: p =>
          interaction.prompt(
            p.type === "select"
              ? {
                  kind: "select",
                  message: p.message,
                  options: p.options.map(o => ({ id: o.id, label: o.label })),
                }
              : {
                  kind: p.type === "manual_code" ? "manual-code" : p.type,
                  message: p.message,
                  placeholder: p.placeholder ?? null,
                },
          ),
        notify: e =>
          interaction.notify(
            e.type === "auth_url"
              ? {
                  kind: "url",
                  url: e.url,
                  instructions: e.instructions ?? null,
                }
              : e.type === "device_code"
                ? {
                    kind: "device-code",
                    code: e.userCode,
                    url: e.verificationUri,
                  }
                : e.type === "info"
                  ? {
                      kind: "info",
                      message: e.message,
                      links: (e.links ?? []).map(l => l.url),
                    }
                  : { kind: "progress", message: e.message },
          ),
      })
    },
    signOut: provider => runtime.logout(provider),
  }
}

/**
 * Which provider and method a sign-in argument names: a provider's id or
 * name, either case, then optionally `oauth` or `api-key`. A provider with
 * one method needs no second word; one with two, unnamed, is `choose`.
 */
export function planSignIn(
  providers: readonly SignInProvider[],
  args: readonly string[],
):
  | { readonly kind: "list" }
  | {
      readonly kind: "sign-in"
      readonly provider: SignInProvider
      readonly method: SignInMethod
    }
  | { readonly kind: "choose"; readonly provider: SignInProvider }
  | { readonly kind: "unknown"; readonly named: string } {
  const [named, how] = args
  if (named === undefined) return { kind: "list" }
  const wanted = named.toLowerCase()
  const provider = providers.find(
    p => p.id.toLowerCase() === wanted || p.name.toLowerCase() === wanted,
  )
  if (provider === undefined || provider.methods.length === 0)
    return { kind: "unknown", named }
  const asked = how === "oauth" ? "oauth" : how === "api-key" ? "api_key" : null
  if (asked !== null && provider.methods.includes(asked))
    return { kind: "sign-in", provider, method: asked }
  const [only, second] = provider.methods
  return only !== undefined && second === undefined
    ? { kind: "sign-in", provider, method: only }
    : { kind: "choose", provider }
}

/** A sign-in notice, as terminal lines. */
export function signInNoticeLines(notice: SignInNotice): readonly string[] {
  switch (notice.kind) {
    case "url":
      return [
        `Open this to sign in: ${notice.url}`,
        ...(notice.instructions === null ? [] : [notice.instructions]),
      ]
    case "device-code":
      return [`Go to ${notice.url} and enter the code ${notice.code}`]
    case "info":
      return [notice.message, ...notice.links]
    case "progress":
      return [notice.message]
  }
}
