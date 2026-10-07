// web/footer — the page's one row of chrome, along its bottom (ADR-0085).
// It splits where your list's edge does. Below your list, what is yours
// (ADR-0098): you, whose avatar and name open the account menu
// (`account-menu.tsx`), then your inbox (`inbox-view.ts`, ADR-0091) and your
// inventory as icons; while your list is folded, your avatar alone, carrying
// the inbox's badge, and both are in its menu. To the right, what is
// everyone's: the board's strip (`board.tsx`), which counts where the agent
// works and what is ready to accept, then "syncing…" while the document is
// pending and the publish button (ADR-0090). The inbox carries the page's
// only badge. Nothing here opens a root until you choose, and nothing closes
// a menu you opened: an open menu keeps a section whose rows have gone, and
// says so.

import type { LineRecord, ProjectRecord, WriterId } from "@pinetrie/core"
import {
  type Intent,
  publishToast,
  publishView,
  publishWords,
  resolveIntent,
} from "@pinetrie/interface"
import type { LineActing, SessionClient } from "@pinetrie/session"
import { type ReactNode, useState, useSyncExternalStore } from "react"
import { AccountMenu, type Me } from "./account-menu.tsx"
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
  line,
  project,
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
  /** The integration line (ADR-0060), as the host last read it. */
  line: LineRecord | null
  /** Where the host runs: "resolve with the agent" works in its root. */
  project: ProjectRecord | null
  /** Where the account menu and the publish toast's "resolve with the agent" go. */
  onIntent: (intent: Intent) => void
  /** Your inventory's toggle: whether its panel is open, and its cards. */
  inventory: InventoryToggleProps
  me: Me
  /**
   * Your list is folded to icons (ADR-0088): the corner, as narrow, holds
   * only your avatar, and your inbox and inventory are in its menu
   * (ADR-0098).
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
        <PublishButton
          line={line}
          onIntent={onIntent}
          project={project}
          session={session}
        />
      </div>
    </footer>
  )
}

/**
 * The publish button (ADR-0090, ADR-0099): set up before the line exists;
 * then publish, only while there is something to publish. A
 * refusal or failure of your last command here is a toast until you dismiss
 * it or send another.
 */
function PublishButton({
  line,
  project,
  session,
  onIntent,
}: {
  line: LineRecord | null
  project: ProjectRecord | null
  session: Pick<SessionClient, "line" | "acting">
  onIntent: (intent: Intent) => void
}) {
  // Your last command here, kept by the session until your next.
  const acting = useSyncExternalStore(
    session.acting.subscribe,
    session.acting.current,
  ).line
  const [dismissed, setDismissed] = useState<LineActing | null>(null)
  const view = publishView(line)
  const said = acting === dismissed ? null : publishToast(acting)
  const resolve = said?.resolve === true ? resolveIntent(project, line) : null
  const toast =
    said === null ? null : (
      <Toast
        action={
          resolve === null
            ? null
            : {
                label: "resolve with the agent",
                onChoose: () => onIntent(resolve),
              }
        }
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
        <button
          className="publish-button"
          data-refused={words.refused || undefined}
          disabled={waiting}
          onClick={() => void session.line("publish")}
          title={words.title}
          type="button"
        >
          {words.label}
        </button>
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
                  onChoose: () => void session.line("setup"),
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
