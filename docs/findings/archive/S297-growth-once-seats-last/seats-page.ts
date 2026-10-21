// S297's seats page: opens the origin's store and says which seat it holds.

import { Exchange } from "@kyneta/exchange"
import { createIndexedDBStore } from "@kyneta/indexeddb-store"

;(window as any).probe = {
  async open(noLocks: boolean) {
    const store = await createIndexedDBStore("s297", noLocks ? { locks: null } : {})
    const ex = new Exchange({ principal: "ada@s297.test", store })
    ;(window as any).ex = ex
    return ex.peerId
  },
}
