# Class Timer

A classroom timer for teachers, built for projecting during lessons.

**Live app:** https://hash-wa.github.io/class-timer/

## What it does

- **Auto-starts at class time.** Configure one or more classes with preset start times (e.g. 9:40, 10:50, 12:00). When the wall clock reaches a class's start time, its timer begins automatically — even if you open the page a few minutes late, it picks up in the right place.
- **Class progress bar (top right, dimmed).** Start and end times around a slim progress bar with the remaining time, based on the class duration you set (or the sum of its activities if left blank). When a class duration is set, the last activity automatically stretches to fill whatever time remains until the class end.
- **Activity countdown.** The current activity's name, a large countdown, and a gradient progress bar. The bar and countdown turn amber for the final stretch (roughly the last 15%, between 30 s and 2 min) as a "wrap it up" cue; when time is up, the bar blinks rapidly (and an optional chime sounds) until you press **Next Activity** — which you can also press early to move on ahead of schedule.
- **Stay on plan.** **◂ Back** (or ←) undoes an accidental advance and restores the previous activity's clock. **−1 / +1 / +5 min** buttons stretch or shave the current activity when class runs long. The activity list shows each activity's projected clock window, recomputed live, and the header shows how far ahead of or behind plan you are.
- **Activity sets.** Activities (name + duration) are grouped into reusable sets. Different classes can use different sets, and multiple classes can share the same set with different start times.

## Usage

1. Open the app and click **⚙ Setup**.
2. Create an activity set (list of activities with durations in minutes).
3. Add classes: name, start time, duration (blank = sum of activities), and pick an activity set.
4. Leave the page open — each class starts on its own at its start time. Press **Next Activity** (or Space / → / N) to advance.

Once a class's time window has fully passed, the app shows a countdown to tomorrow's start instead of elapsed time.

Handy extras:

- Light and dark themes (toggle button, or the **D** key)
- Fullscreen for projection (**F** key) — the layout scales to fill the screen, with an optional "dim the screen in fullscreen" setting
- "Keep screen on" option (screen wake-lock) so the display doesn't sleep mid-lesson
- End-of-activity chime toggle
- Keyboard shortcuts: Space / → / N = Next Activity, ← = Back (presenter remotes work: PageDown / PageUp)
- The browser tab title shows the live countdown, so the timer stays visible while you present other tabs
- Export/Import JSON to move your setup between computers (settings are stored in the browser's localStorage)

## Development

Plain HTML/CSS/JS — no build step. Open `index.html` in a browser, or serve the folder with any static server. Pushing to `main` deploys to GitHub Pages via the included workflow.
