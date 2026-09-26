// client/tab-state — a value kept per browser tab, with the device's latest as
// the fallback.
//
// Two slots under one key: the tab's (`sessionStorage`), which survives a
// reload, and the device's (`localStorage`), which holds the latest save from
// any tab and is what a new tab starts from. Browsers copy `sessionStorage`
// into a duplicated tab, so a duplicate starts with its original's value.
//
// Generic: it knows nothing of Pineta. A value's stored form is its codec's.

/** The part of `Storage` used here. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** A value's stored form, both ways. `decode` is total: it never throws. */
export interface Codec<T> {
  readonly encode: (value: T) => unknown
  readonly decode: (raw: unknown) => T | undefined
}

export interface TabState<T> {
  /** This tab's value, else the device's latest, else undefined. */
  load(): T | undefined
  /** Writes both slots. */
  save(value: T): void
}

/** What a slot holds, decoded; undefined when empty, not JSON, or not a `T`. */
export function readStored<T>(
  raw: string | null,
  decode: Codec<T>["decode"],
): T | undefined {
  if (raw === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  return decode(parsed)
}

export function tabState<T>({
  key,
  codec,
  tab,
  device,
}: {
  readonly key: string
  readonly codec: Codec<T>
  readonly tab: StorageLike
  readonly device: StorageLike
}): TabState<T> {
  return {
    // Reads are not guarded: where storage is disabled, reaching the
    // `Storage` object itself throws, so there is nothing here to read from.
    load: () =>
      readStored(tab.getItem(key), codec.decode) ??
      readStored(device.getItem(key), codec.decode),
    save(value) {
      const raw = JSON.stringify(codec.encode(value))
      // A full quota costs this save and nothing else: each slot is written
      // or not on its own.
      for (const slot of [tab, device]) {
        try {
          slot.setItem(key, raw)
        } catch {}
      }
    },
  }
}
