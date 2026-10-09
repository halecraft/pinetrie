import { Exchange } from "@kyneta/exchange"
import { entryId, type RootRecord, threadIdFor, writerId } from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { expect, test } from "vitest"
import { attentionStore, EARLIEST, startOf } from "./attention-doc.ts"

const ME = writerId("ada@x.io")
const LANE = threadIdFor("a")

test("before the host's copy arrives, your attention document is not written: an early write could undo another device's (S101)", () => {
  const exchange = new Exchange({ principal: "ada@x.io" })
  const store = attentionStore(exchange, ME, "seat-host", () => "0")
  store.read(LANE, entryId("e-1"))
  store.leave()
  store.dismiss(LANE, entryId("p-1"))
  store.dismissOffer(LANE, cardIdFor("c1"))
  store.setInbox({ since: "e-9", seen: ["e-10"] })
  expect(store.attention.current()).toEqual({
    since: "",
    mentionsSince: "",
    read: new Map(),
    dismissed: new Map(),
    dismissedOffers: new Map(),
    seen: new Set(),
  })
  store.dispose()
})

test("a person starts at the directory's newest entry, or EARLIEST, below every id, in an empty session", () => {
  const root = (newest: string | null) => ({ newest }) as unknown as RootRecord
  expect(startOf([root("01a0-2"), root(null), root("01a0-9")])).toBe("01a0-9")
  expect(startOf([])).toBe(EARLIEST)
  expect("01a0ffd2-0000-7000" > EARLIEST).toBe(true)
})
