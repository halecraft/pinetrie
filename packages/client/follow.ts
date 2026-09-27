// client/follow — when a scroller follows its end, as a pure rule.
//
// The scroller only ever moves down on its own, so a move up was the reader's.
// It remembers where it last left the scroll: a scroll event above that is
// the reader leaving, unless it lands exactly at the end, where content that
// shrank clamps it. The echo of its own follow never
// is, however much the content has grown since (S32: the browser dispatches
// scroll events before ResizeObserver callbacks, so the reader's scroll is
// seen before the next follow could undo it).

/** What a scroller reports: read from the element, nothing else. */
export interface Metrics {
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
}

export interface FollowState {
  /** Following: every change of height scrolls to the end. */
  readonly following: boolean
  /** Released, and the content has grown since. Shows ↓ new below. */
  readonly unseen: boolean
  /** Where the scroll was last left, by the scroller or by a scroll event. */
  readonly lastTop: number
  readonly lastHeight: number
}

export type FollowEvent =
  /** A ResizeObserver callback: the content or the viewport changed size. */
  | { readonly kind: "resized"; readonly at: Metrics }
  | { readonly kind: "scrolled"; readonly at: Metrics }
  /** Something outside placed the scroll on purpose (`alignOnOpen`, `useReveal`). */
  | { readonly kind: "placed"; readonly at: Metrics }
  /** The reader's own send, or ↓ new below. */
  | { readonly kind: "follow"; readonly at: Metrics }

export interface FollowPlan {
  readonly state: FollowState
  /** Set `scrollTop` to this, or leave it. */
  readonly scrollTo: number | null
}

/** How near the end a scroll down must come to follow again. */
export const FOLLOW_SLACK = 24

/** `scrollTop` can be fractional under zoom: moves within this are none. */
const JITTER = 1

/** A scroller opens following, so it lands at its end unless placed. */
export const initialFollow: FollowState = {
  following: true,
  unseen: false,
  lastTop: 0,
  lastHeight: 0,
}

const end = (m: Metrics) => Math.max(0, m.scrollHeight - m.clientHeight)
const gap = (m: Metrics) => m.scrollHeight - m.scrollTop - m.clientHeight

/** Follow: scroll to the end, and remember leaving the scroll there. */
const toEnd = (m: Metrics): FollowPlan => ({
  state: {
    following: true,
    unseen: false,
    lastTop: end(m),
    lastHeight: m.scrollHeight,
  },
  scrollTo: end(m),
})

export function follow(state: FollowState, event: FollowEvent): FollowPlan {
  const m = event.at
  switch (event.kind) {
    case "resized":
      if (state.following) return toEnd(m)
      return {
        state: {
          ...state,
          unseen: state.unseen || m.scrollHeight > state.lastHeight,
          lastHeight: m.scrollHeight,
        },
        scrollTo: null,
      }
    case "scrolled": {
      // Content that shrank clamps the scroll up to the new end: not the
      // reader. Content can also shrink while the reader scrolls up (a
      // click that scrolls a button into view and removes it), so the
      // height alone cannot tell them apart.
      const clamped = gap(m) <= JITTER
      const movedUp = m.scrollTop < state.lastTop - JITTER && !clamped
      const seen = { lastTop: m.scrollTop, lastHeight: m.scrollHeight }
      if (movedUp)
        return {
          state: { ...state, ...seen, following: false },
          scrollTo: null,
        }
      if (gap(m) <= FOLLOW_SLACK)
        return {
          state: { ...seen, following: true, unseen: false },
          scrollTo: null,
        }
      return { state: { ...state, ...seen }, scrollTo: null }
    }
    case "placed":
      return {
        state: {
          following: gap(m) <= FOLLOW_SLACK,
          unseen: false,
          lastTop: m.scrollTop,
          lastHeight: m.scrollHeight,
        },
        scrollTo: null,
      }
    case "follow":
      return toEnd(m)
  }
}
