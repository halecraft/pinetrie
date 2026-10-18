import { threadIdFor, writerId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import type { AccessNews } from "./access.ts"
import { renderableMessage } from "./message.ts"
import { planSshNews } from "./ssh-news.ts"
import { decodeCarryOn } from "./stop.ts"

const LANE = threadIdFor("t-1")
const DUANE = writerId("duane@x.io")
const news = (kind: AccessNews["kind"]): AccessNews => ({
  kind,
  host: "hql",
  owner: DUANE,
})

describe("planSshNews", () => {
  test("an approval wakes its lane with its owner's carry-on", () => {
    const delivery = planSshNews(news("approved"), LANE, "Duane", 1)
    expect(delivery.wakes).toBe(true)
    expect(decodeCarryOn(delivery.message)).toEqual({
      lane: LANE,
      by: DUANE,
      name: "Duane",
      reason: { kind: "ssh-approved", host: "hql" },
    })
    for (const kind of ["asked", "refused", "revoked"] as const)
      expect(planSshNews(news(kind), LANE, "Duane", 1).wakes).toBe(false)
  })

  test("the agent is told to end its turn while it waits", () => {
    const { message } = planSshNews(news("asked"), LANE, "Duane", 1)
    expect(message.content).toContain("Do not retry")
    expect(message.content).toContain("end your turn")
    expect(renderableMessage(message)).toEqual({
      role: "fact",
      content: "asked Duane for their ssh for hql",
    })
  })
})
