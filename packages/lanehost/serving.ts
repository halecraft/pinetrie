// lanehost/serving — a server's arguments, from the command that starts it
// (`serverArgs`) and back.

import type { Serving } from "./answer.ts"
import { FOLDER_MOUNT } from "./layout.ts"
import { isRole, type Role, type RoleFacts } from "./roles.ts"

/** The server's script, from the root of pine·trie's install. */
export const SERVER = "packages/lanehost/server.ts"
/** The one-shot command beside it, for the suites (`once.ts`). */
export const ONCE = "packages/lanehost/once.ts"

/** The arguments a role's server is started with. */
export const serverArgs = (
  role: Role,
  lanesDir: string,
  facts: RoleFacts,
): readonly string[] => [role, lanesDir, JSON.stringify(facts)]

/**
 * `serverArgs` back; throws on arguments that are not a role's. The
 * project's root is at `FOLDER_MOUNT` unless the facts name another
 * (`folder`), as a test serving in its own process does.
 */
export function servingFrom(args: readonly string[]): Serving {
  const [role = "", lanesDir = "", facts = "{}"] = args
  if (!isRole(role)) throw new Error(`not a role: ${JSON.stringify(role)}`)
  if (!lanesDir.startsWith("/"))
    throw new Error(`not a lanes directory: ${lanesDir}`)
  const parsed = JSON.parse(facts) as { rootless?: unknown; folder?: unknown }
  return {
    role,
    lanesDir,
    facts: { rootless: parsed.rootless === true },
    folder:
      typeof parsed.folder === "string" && parsed.folder.startsWith("/")
        ? parsed.folder
        : FOLDER_MOUNT,
  }
}
