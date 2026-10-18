import {
  type LaneGrants,
  NO_GRANTS,
  nestedLaneDockerNote,
} from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { laneFacts } from "./containers.ts"

test("laneFacts: a lane is told each grant its config holds", () => {
  const facts = (grants: LaneGrants) =>
    laneFacts({
      grants,
      ssh: { personal: false, services: [] },
      shared: [],
      defaultImage: false,
      kind: "jj",
    }).grants
  expect(facts(NO_GRANTS)).toEqual({
    ssh: { personal: false, services: [] },
    nestedDockerNote: null,
    env: [],
    mounts: [],
  })
  const mount = (target: string) => ({
    source: `/host${target}`,
    target,
    readonly: true,
  })
  expect(
    facts({
      ...NO_GRANTS,
      nested: true,
      env: ["CI", "NPM_TOKEN"],
      mounts: [mount("/data"), mount("/ref")],
    }),
  ).toEqual({
    ssh: { personal: false, services: [] },
    nestedDockerNote: nestedLaneDockerNote,
    env: ["CI", "NPM_TOKEN"],
    mounts: ["/data", "/ref"],
  })
})
