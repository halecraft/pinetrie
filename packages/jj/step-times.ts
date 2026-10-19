// What one step on the owner of your repo spent: its named parts, each
// part's own time without the parts inside it, and the jj and git commands
// it ran. A slow step's report carries it, so its log line says where the
// time went.

/** One named part of a step, and the time spent in it outside the parts inside it. */
export interface StepPart {
  readonly name: string
  readonly ms: number
}

/** Where a step's time went. */
export interface StepSplit {
  /** In the order each name was first entered; a name entered twice adds up. */
  readonly parts: readonly StepPart[]
  /** The jj and git commands the step ran, and their time together. */
  readonly commands: { readonly count: number; readonly ms: number }
}

export const NO_SPLIT: StepSplit = { parts: [], commands: { count: 0, ms: 0 } }

export interface StepTimes {
  /**
   * Time `work` as the part `name`. A step's parts run one after another,
   * or one inside another: two side by side would be timed as nested.
   */
  part<T>(name: string, work: () => Promise<T>): Promise<T>
  /** One command the step ran, and how long it took. */
  command(ms: number): void
  split(): StepSplit
}

export function createStepTimes(now: () => number): StepTimes {
  const totals = new Map<string, number>()
  /** The parts open now, innermost last, with the time their inner parts took. */
  const open: { inner: number }[] = []
  let count = 0
  let commandMs = 0
  return {
    async part(name, work) {
      if (!totals.has(name)) totals.set(name, 0)
      const frame = { inner: 0 }
      open.push(frame)
      const started = now()
      try {
        return await work()
      } finally {
        const elapsed = now() - started
        open.pop()
        totals.set(name, (totals.get(name) ?? 0) + elapsed - frame.inner)
        const outer = open.at(-1)
        if (outer !== undefined) outer.inner += elapsed
      }
    },
    command(ms) {
      count += 1
      commandMs += ms
    },
    split: () => ({
      parts: [...totals].map(([name, ms]) => ({ name, ms })),
      commands: { count, ms: commandMs },
    }),
  }
}
