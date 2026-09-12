# Class Timer

A classroom timer for teachers, built for projecting during lessons.

**Live app:** https://hash-wa.github.io/class-timer/

## What it does

- **Auto-starts at class time.** Configure one or more classes with preset start times (e.g. 9:40, 10:50, 12:00). When the wall clock reaches a class's start time, its timer begins automatically — even if you open the page a few minutes late, it picks up in the right place.
- **One segmented progress bar for the whole class, live.** The bar is divided into a segment per activity. Each segment shows the activity's name and its live duration in its middle, and the boundary times between activities sit above the bar. The last activity always absorbs whatever the earlier ones ran under or over, so the bar keeps spanning the full class: finish an activity early and everything after it shifts left (the last segment grows); run long and everything shifts right (the last segment shrinks). The current segment fills as it runs, turns amber for the final stretch, and blinks when time is up (with an optional chime) until you press the round **▸** button — which you can also press early to move on ahead of schedule.
- **Big countdown, fixed in place.** The large countdown for the current (or next) activity always sits in the same spot, whether the class hasn't started, is running, or between activities.
- **Stay on plan.** **◂ Back** (or ←) undoes an accidental advance and restores the previous activity's clock. The round **−1 / +1 / +5** buttons stretch or shave the current activity when class runs long — time added or removed comes out of the last activity, shrinking or growing its segment to match. A small note above the counter shows how far ahead of or behind plan you are.
- **Activity sets.** Activities (name + duration) are grouped into reusable sets. Different classes can use different sets, and multiple classes can share the same set with different start times.

## Usage

1. Open the app and click **⚙ Setup**.
2. Create an activity set (list of activities with durations in minutes).
3. Add classes: name, start time, duration (blank = sum of activities), and pick an activity set.
4. Leave the page open — each class starts on its own at its start time. Press **Next Activity** (or Space / → / N) to advance.

Once a class's time window has fully passed, the app shows a countdown to tomorrow's start instead of elapsed time.

Handy extras:

- Light and dark themes (toggle button, or the **D** key)
- Fullscreen for projection (**F** key) — hides everything but the timer card and scales it to the screen, with an optional "dim the screen in fullscreen" setting
- "Keep screen on" option (screen wake-lock) so the display doesn't sleep mid-lesson
- End-of-activity chime toggle
- Keyboard shortcuts: Space / → / N = Next Activity, ← = Back (presenter remotes work: PageDown / PageUp)
- The browser tab title shows the live countdown, so the timer stays visible while you present other tabs
- Export/Import JSON to move your setup between computers (settings are stored in the browser's localStorage)

## Development

Plain HTML/CSS/JS — no build step. Open `index.html` in a browser, or serve the folder with any static server. Pushing to `main` deploys to GitHub Pages via the included workflow.
