// client/follow — when a scroller follows its end, as a pure rule.
//
// The scroller only ever moves down on its own, so a move up was the reader's.
// It remembers where it last left the scroll: a scroll event above that is
// the reader leaving, unless it lands exactly at the end, where content that
// shrank clamps it. The echo of its own follow never
// is, however much the content has grown since (S32: the browser dispatches
// scroll events before ResizeObserver callbacks, so the reader's scroll is
// seen before the next follow could undo it).
//
// While something works at the end (`holding`), a following scroller does not
// get shorter: a shrink is taken up by a floor below the content, which what
// grows next fills (S35). A ResizeObserver callback runs after layout and
// before paint, so the floor is painted in the frame the content shrank in.

/** What a scroller reports: read from the element, nothing else. */
export interface Metrics {
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
  /**
   * The content's own height. `scrollHeight` is at least the viewport's, so
   * it cannot say how far short content shrank.
   */
  readonly content: number
  /** The floor's height now. */
  readonly floor: number
}

export interface FollowState {
  /** Following: every change of height scrolls to the end. */
  readonly following: boolean
  /** Released, and the content has grown since. Shows ↓ new below. */
  readonly unseen: boolean
  /** Where the scroll was last left, by the scroller or by a scroll event. */
  readonly lastTop: number
  readonly lastHeight: number
  /** Work is being written at the end: shrinks are floored. */
  readonly holding: boolean
  /** The content's height and the floor's together, when last set. */
  readonly held: number
}

export type FollowEvent =
  /** A ResizeObserver callback: the content or the viewport changed size. */
  | { readonly kind: "resized"; readonly at: Metrics }
  | { readonly kind: "scrolled"; readonly at: Metrics }
  /** Something outside placed the scroll on purpose (`alignOnOpen`, `useReveal`). */
  | { readonly kind: "placed"; readonly at: Metrics }
  /** The reader's own send, or ↓ new below. */
  | { readonly kind: "follow"; readonly at: Metrics }
  /** Work at the end started or stopped. */
  | { readonly kind: "holding"; readonly value: boolean; readonly at: Metrics }

export interface FollowPlan {
  readonly state: FollowState
  /** Set `scrollTop` to this, or leave it. Set after `floor`. */
  readonly scrollTo: number | null
  /** The floor's height to set. */
  readonly floor: number
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
  holding: false,
  held: 0,
}

const end = (m: Metrics) => Math.max(0, m.scrollHeight - m.clientHeight)
const gap = (m: Metrics) => m.scrollHeight - m.scrollTop - m.clientHeight

/** `m` with the floor at `floor`: the scroller's height as it will be. */
const withFloor = (m: Metrics, floor: number): Metrics => ({
  ...m,
  scrollHeight: Math.max(m.clientHeight, m.scrollHeight - m.floor + floor),
  floor,
})

/** Follow: scroll to the end, and remember leaving the scroll there. */
const toEnd = (state: FollowState, measured: Metrics): FollowPlan => {
  const floor = state.holding ? Math.max(0, state.held - measured.content) : 0
  const m = withFloor(measured, floor)
  return {
    state: {
      following: true,
      unseen: false,
      lastTop: end(m),
      lastHeight: m.scrollHeight,
      holding: state.holding,
      held: m.content + floor,
    },
    scrollTo: end(m),
    floor,
  }
}

export function follow(state: FollowState, event: FollowEvent): FollowPlan {
  const m = event.at
  switch (event.kind) {
    case "resized": {
      if (state.following) return toEnd(state, m)
      // Released: a floor already there stays, so the reader's place does not
      // move; it grows no more.
      const floor = state.holding ? m.floor : 0
      const at = withFloor(m, floor)
      return {
        state: {
          ...state,
          unseen: state.unseen || at.scrollHeight > state.lastHeight,
          lastHeight: at.scrollHeight,
          held: m.content + floor,
        },
        scrollTo: null,
        floor,
      }
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
          floor: m.floor,
        }
      if (gap(m) <= FOLLOW_SLACK)
        return {
          state: { ...state, ...seen, following: true, unseen: false },
          scrollTo: null,
          floor: m.floor,
        }
      return { state: { ...state, ...seen }, scrollTo: null, floor: m.floor }
    }
    case "placed": {
      const at = withFloor(m, 0)
      return {
        state: {
          ...state,
          following: gap(at) <= FOLLOW_SLACK,
          unseen: false,
          lastTop: m.scrollTop,
          lastHeight: at.scrollHeight,
          held: m.content,
        },
        scrollTo: null,
        floor: 0,
      }
    }
    case "follow":
      return toEnd(state, m)
    // No scroll: turning off drops the floor, and a scroller at its end stays
    // there as the browser clamps it.
    case "holding": {
      const floor = event.value ? m.floor : 0
      return {
        state: { ...state, holding: event.value, held: m.content + floor },
        scrollTo: null,
        floor,
      }
    }
  }
}
