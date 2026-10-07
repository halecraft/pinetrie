// web/account-menu — you, at the footer's left (ADR-0098): your avatar and
// name, opening a menu headed by who you are, your email included. It offers
// your profile page and signing in as someone else (ADR-0037). While your
// list is folded, the corner holds your avatar alone, carrying the inbox's
// badge, and the menu holds the inbox and the inventory too: choosing the
// inbox shows its sections in the same box, after a back item. What the menu
// holds is `accountView`'s.

import type { WriterId } from "@pinetrie/core"
import {
  type AccountItem,
  accountView,
  accountWords,
  BACK,
  type Intent,
} from "@pinetrie/interface"
import { useState } from "react"
import { type InboxMenuProps, useInboxMenu } from "./inbox-menu.tsx"
import type { InventoryToggleProps } from "./inventory-toggle.tsx"
import { Menu, type MenuItem, type MenuSection } from "./menu.tsx"
import { Initial, nameFor } from "./presence.tsx"

export interface Me {
  readonly writer: WriterId
  /** `session.principal`: your email. */
  readonly email: string
}

export function AccountMenu({
  writer,
  email,
  nameOf,
  colorOf,
  folded,
  inbox,
  inventory,
  onIntent,
}: Me & {
  readonly nameOf: ReadonlyMap<WriterId, string>
  readonly colorOf: (writer: WriterId) => string
  readonly folded: boolean
  readonly inbox: InboxMenuProps
  readonly inventory: InventoryToggleProps
  /** Where Profile and "sign in as someone else" go. */
  readonly onIntent: (intent: Intent) => void
}) {
  const shown = nameFor(nameOf, writer)
  const [inInbox, setInInbox] = useState(false)
  const inboxMenu = useInboxMenu(inbox)
  const view = accountView({
    folded,
    badge: inboxMenu.view.badge,
    inventory,
  })
  const avatar = (className: string) => (
    <Initial
      className={className}
      colorOf={colorOf}
      nameOf={nameOf}
      writer={writer}
    />
  )
  const item = (it: AccountItem): MenuItem => {
    const words = accountWords(it)
    const base = {
      key: it.kind,
      className: CLASS[it.kind],
      ...(words.title === undefined ? {} : { title: words.title }),
    }
    switch (it.kind) {
      case "inbox":
        return {
          ...base,
          keepOpen: true,
          label: (
            <>
              {words.label}
              {it.badge > 0 && <span className="menu-badge">{it.badge}</span>}
            </>
          ),
          onChoose: () => {
            inboxMenu.onToggle(true)
            setInInbox(true)
          },
        }
      case "inventory":
        return {
          ...base,
          label: (
            <>
              {words.label}
              {it.count > 0 && <span className="menu-count">{it.count}</span>}
            </>
          ),
          onChoose: inventory.onToggle,
        }
      case "profile":
        return {
          ...base,
          label: words.label,
          onChoose: () => onIntent({ kind: "page", to: "profile" }),
        }
      case "signOut":
        return {
          ...base,
          label: words.label,
          onChoose: () => onIntent({ kind: "signOut" }),
        }
    }
  }
  // Folded, the inbox's sections replace the menu's own, after a way back.
  const showsInbox = inInbox && folded
  const sections: readonly MenuSection[] = showsInbox
    ? [
        {
          key: "inbox",
          heading: inboxMenu.words.heading,
          items: [
            {
              key: "back",
              className: "account-back",
              keepOpen: true,
              label: BACK,
              onChoose: () => {
                inboxMenu.onToggle(false)
                setInInbox(false)
              },
            },
          ],
        },
        ...inboxMenu.sections.slice(1),
      ]
    : [{ key: "account", items: view.items.map(item) }]
  return (
    <Menu
      className="account"
      focusKey={showsInbox ? "inbox" : "account"}
      label={`you: ${shown}`}
      lead={
        showsInbox ? undefined : (
          <div className="account-lead">
            {avatar("me me-large")}
            <div className="account-who">
              <span className="account-name">{shown}</span>
              <span className="profile-email">{email}</span>
            </div>
          </div>
        )
      }
      onToggle={open => {
        if (open) return
        inboxMenu.onToggle(false)
        setInInbox(false)
      }}
      sections={sections}
      title={shown}
      trigger={
        <>
          {avatar("me")}
          {!folded && <span className="me-name">{shown}</span>}
          {view.badge !== null && (
            <span className="inbox-badge" data-needs-you={view.badge}>
              {view.badge}
            </span>
          )}
        </>
      }
      triggerClassName="me-trigger"
    />
  )
}

const CLASS: Readonly<Record<AccountItem["kind"], string>> = {
  inbox: "account-inbox",
  inventory: "account-inventory",
  profile: "account-profile",
  signOut: "not-you",
}
