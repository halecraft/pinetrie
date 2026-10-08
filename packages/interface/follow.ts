// interface/follow — when a scroller follows its end, as a pure rule.
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
// The floor is at most FLOOR_MAX of the view: past that the scroller shrinks,
// and two thirds of it still show content.
//
// A scroller that is unmounted and mounted again (a column of a root
// shown again) starts from a `SeenEnd`: whether it had moved past what its
// reader saw. A placement short of the end keeps that, so ↓ new below shows.
//
// Released, it keeps the column's tip from when the reader left the end
// (`releasedTip`): an ask whose run ended after it stays open under the
// reader until they come back down (ADR-0106).

import type { EntryId } from "@pinetrie/core"

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
  /** The column's tip now: not the element's, but what a release keeps. */
  readonly tip: EntryId | null
}

export interface FollowState {
  /** Following: every change of height scrolls to the end. */
  readonly following: boolean
  /**
   * Released, and the content has grown since, or it started so (`behind`).
   * Shows ↓ new below.
   */
  readonly unseen: boolean
  /** Where the scroll was last left, by the scroller or by a scroll event. */
  readonly lastTop: number
  readonly lastHeight: number
  /** Work is being written at the end: shrinks are floored. */
  readonly holding: boolean
  /** The content's height and the floor's together, when last set. */
  readonly held: number
  /** The column's tip when the reader left its end; null while following. */
  readonly releasedTip: EntryId | null
}

export type FollowEvent =
  /** A ResizeObserver callback: the content or the viewport changed size. */
  | { readonly kind: "resized"; readonly at: Metrics }
  | { readonly kind: "scrolled"; readonly at: Metrics }
  /**
   * Something outside placed the scroll on purpose (`alignOnOpen`,
   * `useReveal`). Short of the end, what was unseen stays unseen.
   */
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

/** The most of the view a floor takes. */
export const FLOOR_MAX = 1 / 3

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
  releasedTip: null,
}

const end = (m: Metrics) => Math.max(0, m.scrollHeight - m.clientHeight)
const gap = (m: Metrics) => m.scrollHeight - m.scrollTop - m.clientHeight

/**
 * `floor`, cut to FLOOR_MAX of the view. Applied wherever a floor is set, so
 * a view that got shorter under a standing floor cuts it too.
 */
const capFloor = (m: Metrics, floor: number) =>
  Math.min(floor, FLOOR_MAX * m.clientHeight)

/** `m` with the floor at `floor`: the scroller's height as it will be. */
const withFloor = (m: Metrics, floor: number): Metrics => ({
  ...m,
  scrollHeight: Math.max(m.clientHeight, m.scrollHeight - m.floor + floor),
  floor,
})

/** Follow: scroll to the end, and remember leaving the scroll there. */
const toEnd = (state: FollowState, measured: Metrics): FollowPlan => {
  const floor = state.holding ? Math.max(0, state.held - measured.content) : 0
  const capped = capFloor(measured, floor)
  const m = withFloor(measured, capped)
  return {
    state: {
      following: true,
      unseen: false,
      lastTop: end(m),
      lastHeight: m.scrollHeight,
      holding: state.holding,
      // What the cap gave up is not claimed again.
      held: m.content + capped,
      releasedTip: null,
    },
    scrollTo: end(m),
    floor: capped,
  }
}

/**
 * The tip a release keeps: the one from when the reader first left the end.
 * Following, there is none; a scroller mounted again may start with one
 * (`SeenEnd.released`) before its placement.
 */
const released = (state: FollowState, m: Metrics): EntryId | null =>
  state.releasedTip ?? m.tip

export function follow(state: FollowState, event: FollowEvent): FollowPlan {
  const m = event.at
  switch (event.kind) {
    case "resized": {
      if (state.following) return toEnd(state, m)
      // Released: a floor already there stays, so the reader's place does not
      // move; it grows no more.
      const floor = state.holding ? capFloor(m, m.floor) : 0
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
          state: {
            ...state,
            ...seen,
            following: false,
            releasedTip: released(state, m),
          },
          scrollTo: null,
          floor: m.floor,
        }
      if (gap(m) <= FOLLOW_SLACK)
        return {
          state: {
            ...state,
            ...seen,
            following: true,
            unseen: false,
            releasedTip: null,
          },
          scrollTo: null,
          floor: m.floor,
        }
      return { state: { ...state, ...seen }, scrollTo: null, floor: m.floor }
    }
    case "placed": {
      const at = withFloor(m, 0)
      const following = gap(at) <= FOLLOW_SLACK
      return {
        state: {
          ...state,
          following,
          releasedTip: following ? null : released(state, m),
          unseen: state.unseen && gap(at) > FOLLOW_SLACK,
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
      const floor = event.value ? capFloor(m, m.floor) : 0
      return {
        state: { ...state, holding: event.value, held: m.content + floor },
        scrollTo: null,
        floor,
      }
    }
  }
}

/** What a scroller knew of its end when it was unmounted. */
export interface SeenEnd {
  /** The column's tip then. */
  readonly tip: EntryId | null
  /** Whether ↓ new below was showing. */
  readonly unseen: boolean
  /** Its tip when its reader left its end, if they had (`releasedTip`). */
  readonly released: EntryId | null
}

/**
 * Whether a scroller mounted again has content below that its reader has not
 * seen. Following at unmount, it had seen its tip; released, `unseen` says
 * whether anything grew since.
 */
export const behind = (
  seen: SeenEnd | undefined,
  tip: EntryId | null,
): boolean => seen !== undefined && (seen.unseen || seen.tip !== tip)
