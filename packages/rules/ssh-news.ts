// ssh-news — what a lane is told as its owner's ssh request changes: that
// its owner was asked, refused or took an approval back, as a fact steered
// into its run or appended; and an approval, as the owner's carry-on that
// wakes it. A fact never starts a run: only a prompt's role does
// (`startsRun`), so the one news that wakes is a carry-on.

import { PRODUCT_NAME, type ThreadId } from "@pinetrie/core"
import { type Static, Type } from "typebox"
import type { AccessNews } from "./access.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { CARRY_ON, type CarryOnMessage } from "./stop.ts"

export const SSH_FACT_TYPE = "pinetrie.ssh-fact"

const SshFactSchema = Type.Object({
  news: Type.Union([
    Type.Literal("asked"),
    Type.Literal("refused"),
    Type.Literal("revoked"),
  ]),
  host: Type.Union([Type.String(), Type.Null()]),
  /** The owner, by their display name then, as a chat keeps its author's. */
  ownerName: Type.String(),
})

/** News that never starts a run, as the column and the lane keep it. */
export type SshFact = Static<typeof SshFactSchema>

/** The column draws an ssh fact as a fact row (`sshFactLine`). */
export const SSH_FACT = historyMessage(SSH_FACT_TYPE, SshFactSchema)

export type SshFactMessage = HistoryMessage<typeof SSH_FACT_TYPE, SshFact>

export const decodeSshFact = (message: unknown): SshFact | undefined =>
  SSH_FACT.decode(message)

const forHost = (host: string | null): string => host ?? "a host"

/** The column's line: "asked Duane for their ssh for hql". */
export function sshFactLine(fact: SshFact): string {
  switch (fact.news) {
    case "asked":
      return `asked ${fact.ownerName} for their ssh for ${forHost(fact.host)}`
    case "refused":
      return `${fact.ownerName} refused their ssh for ${forHost(fact.host)}`
    case "revoked":
      return `${fact.ownerName} took back their ssh for ${forHost(fact.host)}`
  }
}

/** What the agent reads of a fact: what happened, and what to do now. */
function sshFactContent(fact: SshFact): string {
  const host = forHost(fact.host)
  switch (fact.news) {
    case "asked":
      return (
        `${PRODUCT_NAME} asked ${fact.ownerName} to let this thread use their ssh for ${host}. ` +
        "Until they answer, ssh refuses their key here. Do not retry: finish what you can " +
        `without it, then end your turn saying you are waiting for ${fact.ownerName} to approve. ` +
        "Their approval wakes you to try again."
      )
    case "refused":
      return `${fact.ownerName} refused this thread their ssh for ${host}. Their key stays refused here: do not ask again.`
    case "revoked":
      return `${fact.ownerName} took back this thread's use of their ssh for ${host}, and its ssh sessions ended. Their key stays refused here: do not ask again.`
  }
}

/** What news is delivered as: an approval is the carry-on that wakes its lane; the rest are facts. */
export type SshDelivery =
  | { readonly wakes: true; readonly message: CarryOnMessage }
  | { readonly wakes: false; readonly message: SshFactMessage }

export function planSshNews(
  news: AccessNews,
  lane: ThreadId,
  ownerName: string,
  now: number,
): SshDelivery {
  if (news.kind === "approved")
    return {
      wakes: true,
      message: CARRY_ON.encode(
        {
          lane,
          by: news.owner,
          name: ownerName,
          reason: { kind: "ssh-approved", host: news.host },
        },
        `${ownerName} approved this thread's use of their ssh for ${forHost(news.host)}. ` +
          "Try again what needed it.",
        now,
      ),
    }
  const fact: SshFact = { news: news.kind, host: news.host, ownerName }
  return {
    wakes: false,
    message: SSH_FACT.encode(fact, sshFactContent(fact), now),
  }
}
