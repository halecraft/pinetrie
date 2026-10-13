// pi/observer — the observer's side of a lane's helper: how a tool call is
// launched so that the machine's observer sees it begin as a run. Its events
// reach the host from the observer itself (`@pinetrie/lanehost`'s machine
// role), never through the helper.

/**
 * The variable a run's first process execs with: its number, in decimal.
 * An untagged process in a registered lane's cgroup that execs with it
 * begins the run, and everything it starts is the run's.
 */
export const RUN_ENV = "PINETRIE_RUN"

/**
 * pi `exec`'s options for run `run`: pi spawns the command's shell with
 * `{ ...process.env, ...shellEnv, ...options.env }`, so the variable is
 * the run's whatever the caller gave.
 */
export const launchOptions = (
  run: string,
  options: object | undefined,
): object => {
  const given = options as { readonly env?: Record<string, string> } | undefined
  return { ...options, env: { ...given?.env, [RUN_ENV]: run } }
}
