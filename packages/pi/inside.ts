// pi/inside — what a facade carries that only this package may read.
//
// The host holds `Scribe` and `PiSetup`, whose types name no pi type
// (ADR-0003). `createAgent` needs what is behind them: the scribe's sessions,
// the setup's model runtime. Each factory seals that beside the facade it
// returns, and `createAgent` opens it. This module is not exported from
// `index.ts`, so nothing outside the package can open a facade.

export interface Sealed<P extends object, I> {
  /** Pair `facade` with `inside`, and return the facade. */
  seal(facade: P, inside: I): P
  /** What `seal` paired with `facade`. Throws for an object `maker` did not make. */
  open(facade: P): I
}

export function sealed<P extends object, I>(maker: string): Sealed<P, I> {
  const insides = new WeakMap<P, I>()
  return {
    seal(facade, inside) {
      insides.set(facade, inside)
      return facade
    },
    open(facade) {
      const inside = insides.get(facade)
      if (inside === undefined) throw new Error(`${maker} did not make this`)
      return inside
    },
  }
}
