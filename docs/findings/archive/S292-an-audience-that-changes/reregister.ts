// S292: one policy object registered twice by name. Run as
// apps/pinetrie/e2e/s292-reregister.ts with `node`.

import { Governance } from "@kyneta/exchange"
const peer = { peerId: "p", principal: "bea", type: "user" } as never
const same = { name: "audience", canShare: () => false }
const g1 = new Governance()
g1.register(same)
console.log("same object, once:", g1.canShare("canvas:c1", peer))
g1.register(same)
console.log("same object, registered again by name:", g1.canShare("canvas:c1", peer))
const g2 = new Governance()
g2.register({ name: "audience", canShare: () => false })
g2.register({ name: "audience", canShare: () => false })
console.log("a new object of the same name:", g2.canShare("canvas:c1", peer))
