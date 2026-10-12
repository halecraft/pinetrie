# S166 — Clipping, fading and sliding columns to fold or unfold one keeps the frames of an idle page, on a wide strip of long columns

- **Status:** Answered
- **Led to:** ADR-0137

**Question.** A fold or unfold animates, for 200 ms, the column's
`clip-path`, its body's opacity, and a `transform` on every column after
it. On a strip of eight unfolded columns of 150 messages (21,447
elements), do the frames shown keep up, at full CPU speed and throttled 4×
and 6×? Or must the plan fade only the visible part of the body, or clip
another way?

**Kill criterion.** At 4×, the frames shown during a fold or an unfold
(from the commit) are slower than a trivial animation's on the same page
by more than 2 ms at the 95th percentile, or one goes over 50 ms where the
trivial animation's do not.

**Throw away.** The probe (mode `frames`).

**Answers.**

1. **They keep up.** The frames shown during a fold or an unfold matched
   the baseline at every rate measured: at rate 1 a 95th percentile of
   17–20 ms against 18–20; at 4×, 19–20 ms (fold) and 20–32 ms (unfold)
   against the baseline's 25–26, none over 50 ms. Within the kill
   criterion: the unfold's 32 ms was one run of three, and the baseline's
   own 95th percentile is 25–26 ms.
2. **The main thread is slower, and it does not show.** Starting the
   animations costs the main thread one frame of 50–67 ms at 4× (a fold)
   and one of 100–133 ms (an unfold, its first frame after the commit:
   the new column's layout). The frames shown do not wait for it: the
   animations run on the compositor.
3. **At 6× little holds**, as in S153: the baseline's 95th percentile is
   28–32 ms, the fold's 26–32, and one unfold of three had a 72 ms frame.
4. **No cheaper variant is needed:** the whole body fades, and the clip is
   `clip-path: inset(…)` on the column.

**How it was measured.** Mode `frames` of
`docs/findings/S164-from-unfold-to-drawn/probe.ts` (`FOLD_COLUMNS=8`, 150
messages a column), all columns unfolded, in Chromium's headless shell at
1920 × 1080. Three runs at each rate of: a baseline (a 4 px element moved
for 200 ms), a fold of the second column (clip, fade over 120 ms, the
columns after it slid), and an unfold of it, its animations started by a
`MutationObserver` when the column appears (clip opening, body fading in
over the last 60%, the columns after it sliding back). Each records the
intervals between the screencast's frames, and the main thread's
`requestAnimationFrame` intervals. Figures:
`docs/findings/S166-fold-frames/runs-1x.txt` and `runs-4x-6x.txt`.

**Limits.** Software compositing in the headless shell, as S153's; a GPU
makes these cheaper. Not measured: the turned name and the moving mark,
two small elements more, and a strip whose columns have panes open.
