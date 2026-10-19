// web/footer — the page's one row of chrome, along its bottom. It splits where
// the sidebar's edge does. Below the sidebar, what is yours: you, whose avatar
// and name open the account menu (`account-menu.tsx`), then your inbox
// (`inbox-view.ts`) and your inventory as icons; while the sidebar is folded,
// your avatar alone, carrying the inbox's badge, and both are in its menu. To
// the right, what is everyone's: the board's strip (`board.tsx`), which counts
// where the agent works and what is ready to accept, then "syncing…" while the
// document is pending and the publish button. The inbox carries the page's only
// badge. Nothing here opens a root until you choose, and nothing closes a menu
// you opened: an open menu keeps a section whose rows have gone, and says so.

import type { WriterId } from "@pinetrie/core"
import {
  type AcceptedRecord,
  historyLink,
  type Intent,
  publishToast,
  publishView,
  publishWords,
} from "@pinetrie/interface"
import type { AcceptedActing, SessionClient } from "@pinetrie/session"
import { hashOfPage } from "@pinetrie/web-core"
import { type ReactNode, useState, useSyncExternalStore } from "react"
import { AccountMenu, type Me } from "./account-menu.tsx"
import { Button } from "./button.tsx"
import { InboxMenu, type InboxMenuProps } from "./inbox-menu.tsx"
import {
  InventoryToggle,
  type InventoryToggleProps,
} from "./inventory-toggle.tsx"
import { Menu } from "./menu.tsx"
import { Toast } from "./toast.tsx"

export function Footer({
  syncing,
  strip,
  session,
  nameOf,
  colorOf,
  inbox,
  accepted: line,
  onIntent,
  inventory,
  me,
  folded,
}: {
  /** The document's status is "pending" (`useDocStatus`). */
  syncing: boolean
  /** The board's strip (`BoardStrip`): everyone's, after what is yours. */
  strip: ReactNode
  session: SessionClient
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
  /** What your inbox draws from: in the corner, or folded, in the account menu. */
  inbox: InboxMenuProps
  /** Accepted work, as the host last read it. */
  accepted: AcceptedRecord | null
  /** Where the account menu's choices go. */
  onIntent: (intent: Intent) => void
  /** Your inventory's toggle: whether its panel is open, and its cards. */
  inventory: InventoryToggleProps
  me: Me
  /**
   * The sidebar is folded to icons: the corner, as narrow, holds only your
   * avatar, and your inbox and inventory are in its menu.
   */
  folded: boolean
}) {
  return (
    <footer id="bottom">
      <div className="footer-you">
        <AccountMenu
          {...me}
          colorOf={colorOf}
          folded={folded}
          inbox={inbox}
          inventory={inventory}
          nameOf={nameOf}
          onIntent={onIntent}
        />
        {!folded && (
          <div className="footer-tools">
            <InboxMenu {...inbox} />
            <InventoryToggle {...inventory} />
          </div>
        )}
      </div>
      {strip}
      <div className="footer-right">
        {syncing && <span className="sync-note">syncing…</span>}
        <HistoryLink accepted={line} />
        <PublishButton accepted={line} session={session} />
      </div>
    </footer>
  )
}

/** A folder project's way to its history, in the publish button's place. */
function HistoryLink({ accepted }: { accepted: AcceptedRecord | null }) {
  const link = historyLink(accepted)
  return link === null ? null : (
    <a className="publish-button history-link" href={hashOfPage(link.page)}>
      {link.label}
    </a>
  )
}

/**
 * The publish button: set up before accepted work exists; then publish, only
 * while there is something to publish. A refusal or failure of your last
 * command here is a toast until you dismiss it or send another.
 */
function PublishButton({
  accepted: line,
  session,
}: {
  accepted: AcceptedRecord | null
  session: Pick<SessionClient, "actOnAccepted" | "acting">
}) {
  // Your last command here, kept by the session until your next.
  const acting = useSyncExternalStore(
    session.acting.subscribe,
    session.acting.current,
  ).accepted
  const [dismissed, setDismissed] = useState<AcceptedActing | null>(null)
  const view = publishView(line)
  const said = acting === dismissed ? null : publishToast(acting)
  const toast =
    said === null ? null : (
      <Toast
        action={null}
        onDismiss={() => setDismissed(acting)}
        text={said.text}
      />
    )
  if (view.kind === "absent" || view.kind === "hidden") return toast
  const words = publishWords(view, acting)
  const waiting = acting?.kind === "sent"
  return (
    <>
      {words.kind === "publish" ? (
        <Button
          look="outline"
          className="publish-button"
          data-refused={words.refused || undefined}
          disabled={waiting}
          onClick={() => void session.actOnAccepted("publish")}
          title={`${words.title}\n\nin jj: ${words.jj.join("; ")}`}
        >
          {words.label}
        </Button>
      ) : (
        <Menu
          className="publish-setup"
          label={words.title}
          sections={[
            {
              key: "setup",
              heading: words.heading,
              notes: words.notes,
              items: [
                {
                  key: "setup",
                  className: "setup-action",
                  label: "set up",
                  disabled: waiting,
                  onChoose: () => void session.actOnAccepted("setup"),
                },
              ],
            },
          ]}
          title={words.title}
          trigger={words.label}
          triggerClassName="publish-button"
        />
      )}
      {toast}
    </>
  )
}
