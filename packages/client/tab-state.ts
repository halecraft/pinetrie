// client/tab-state — a value kept in the browser: per browser tab, with the
// device's latest as the fallback (`tabState`); or per device, shared by its
// tabs (`deviceState`).
//
// `tabState` keeps two slots under one key: the tab's (`sessionStorage`), which
// survives a reload, and the device's (`localStorage`), which holds the latest
// save from any tab and is what a new tab starts from. Browsers copy
// `sessionStorage` into a duplicated tab, so a duplicate starts with its
// original's value. `deviceState` keeps only the device's slot, merges on every
// save, and hears other tabs' saves and clears through the `storage` event.
//
// Generic: it knows nothing of Pineta. A value's stored form is its codec's.

/** The part of `Storage` used here. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
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

/**
 * Write one slot. A full quota costs this save and nothing else: the error is
 * dropped, so each slot is written or not on its own.
 */
export function writeSlot(slot: StorageLike, key: string, raw: string): void {
  try {
    slot.setItem(key, raw)
  } catch {}
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
      for (const slot of [tab, device]) writeSlot(slot, key, raw)
    },
  }
}

export interface DeviceState<T> {
  load(): T | undefined
  /** Merge `value` into what is stored, write the result, and return it. */
  save(value: T): T
  /** Remove the stored value. */
  clear(): void
  /**
   * Call `listener` when another tab writes the key: with its value, or with
   * undefined when it was cleared. A write that does not decode is not heard.
   * Returns the unsubscribe.
   */
  subscribe(listener: (value: T | undefined) => void): () => void
}

/** The part of a `storage` event read here. */
interface StorageEventLike {
  readonly key: string | null
  readonly newValue: string | null
}

const isStorageEvent = (e: Event): e is Event & StorageEventLike =>
  "key" in e && "newValue" in e

/**
 * A value kept per device, shared by its tabs. Every save merges with what is
 * stored, so two tabs saving at once both keep their part: `localStorage` is
 * read and written in one task, and the merge is the caller's rule.
 */
export function deviceState<T>({
  key,
  codec,
  device,
  merge,
  events,
}: {
  readonly key: string
  readonly codec: Codec<T>
  readonly device: StorageLike
  readonly merge: (stored: T, value: T) => T
  /** Where `storage` events arrive: `window` in the page. */
  readonly events: Pick<EventTarget, "addEventListener" | "removeEventListener">
}): DeviceState<T> {
  const load = () => readStored(device.getItem(key), codec.decode)
  return {
    load,
    save(value) {
      const stored = load()
      const next = stored === undefined ? value : merge(stored, value)
      writeSlot(device, key, JSON.stringify(codec.encode(next)))
      return next
    },
    clear: () => device.removeItem(key),
    subscribe(listener) {
      // A `storage` event fires only in the other tabs of the device.
      const heard = (e: Event) => {
        if (!isStorageEvent(e) || e.key !== key) return
        if (e.newValue === null) return listener(undefined)
        const value = readStored(e.newValue, codec.decode)
        if (value !== undefined) listener(value)
      }
      events.addEventListener("storage", heard)
      return () => events.removeEventListener("storage", heard)
    },
  }
}
