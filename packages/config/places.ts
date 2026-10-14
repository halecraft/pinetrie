// config/places — where each layer's file is, and pine·trie's own
// directories, from the XDG variables and their defaults. Pure: which system
// candidate exists is the reader's question (`read.ts`).

import path from "node:path"

/** The name every layer's file has. */
export const CONFIG_FILE = "pinetrie.json"

export interface ConfigPlaces {
  /**
   * pine·trie's own directories. A lane never mounts one, or a folder that
   * holds one: they hold credentials, service keys and sessions.
   */
  readonly dirs: {
    /** `$XDG_CONFIG_HOME/pinetrie`, by default `~/.config/pinetrie`. */
    readonly config: string
    /** `$XDG_DATA_HOME/pinetrie`, by default `~/.local/share/pinetrie`. */
    readonly data: string
  }
  /** Each `$XDG_CONFIG_DIRS` entry's (by default `/etc/xdg`) `pinetrie/pinetrie.json`; the first that exists is read. */
  readonly systemCandidates: readonly string[]
  readonly user: string
  /** The person's file for this project; null with no project. */
  readonly local: string | null
  /** Written only by pine·trie's sign-in. */
  readonly credentials: string
  /** Custom providers, in pi's `models.json` format. */
  readonly models: string
}

/**
 * The places for `env` and `home`. `session` names the project's local file:
 * the project folder's name, until sessions get names of their own, so
 * two projects whose folders share a name share it.
 */
export function configPlaces(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  session: string | null,
): ConfigPlaces {
  const set = (name: string) => {
    const v = env[name]
    return v !== undefined && v !== "" && path.isAbsolute(v) ? v : null
  }
  const config = path.join(
    set("XDG_CONFIG_HOME") ?? path.join(home, ".config"),
    "pinetrie",
  )
  const data = path.join(
    set("XDG_DATA_HOME") ?? path.join(home, ".local", "share"),
    "pinetrie",
  )
  const systemDirs = (env.XDG_CONFIG_DIRS ?? "")
    .split(":")
    .filter(d => path.isAbsolute(d))
  return {
    dirs: { config, data },
    systemCandidates: (systemDirs.length > 0 ? systemDirs : ["/etc/xdg"]).map(
      d => path.join(d, "pinetrie", CONFIG_FILE),
    ),
    user: path.join(config, CONFIG_FILE),
    local:
      session === null
        ? null
        : path.join(config, "sessions", session, CONFIG_FILE),
    credentials: path.join(data, "auth.json"),
    models: path.join(config, "models.json"),
  }
}

/** pine·trie's own directories, which no lane may mount or hold. */
export const ownDirs = (places: ConfigPlaces): readonly string[] =>
  Object.values(places.dirs)
