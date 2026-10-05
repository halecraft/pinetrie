// pi/compaction — the compaction settings every lane's harness runs with,
// and the land message's budget derived from them (ADR-0084).
//
// pi keeps the newest messages back to `keepRecentTokens`, by
// `estimateTokens`, and summarises the rest; it never cuts the newest
// message. So a resolution's prompt within `keepRecentTokens`, as pi
// estimates it, is kept whole beside the summary.

import {
  type CompactionSettings,
  DEFAULT_COMPACTION_SETTINGS,
  estimateTokens,
} from "@earendil-works/pi-agent-core"
import { LAND_TYPE, type PromptBudget } from "@pinetrie/rules"

/**
 * The settings `createAgent` gives every harness. pi's defaults today: the
 * harness reads no person's `settings.json`, so these are all it uses.
 */
export const PINETRIE_COMPACTION: CompactionSettings =
  DEFAULT_COMPACTION_SETTINGS

/** A land message's limit: what pi keeps whole when it compacts, by pi's own estimate. */
export const LAND_BUDGET: PromptBudget = {
  tokens: PINETRIE_COMPACTION.keepRecentTokens,
  estimate: content =>
    estimateTokens({
      role: "custom",
      customType: LAND_TYPE,
      content,
      display: true,
      timestamp: 0,
    }),
}
