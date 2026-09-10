# Class Timer

A classroom timer for teachers, built for projecting during lessons.

**Live app:** https://hash-wa.github.io/class-timer/

## What it does

- **Auto-starts at class time.** Configure one or more classes with preset start times (e.g. 9:40, 10:50, 12:00). When the wall clock reaches a class's start time, its timer begins automatically — even if you open the page a few minutes late, it picks up in the right place.
- **Class countdown (top, dimmed).** The class start → end window with a countdown to the finish time, based on the class duration you set (or the sum of its activities if left blank).
- **Activity countdown.** The current activity's name, a large countdown, and a gradient progress bar. When an activity's time is up, the bar blinks rapidly (and an optional chime sounds) until you press **Next Activity** — which you can also press early to move on ahead of schedule.
- **Activity sets.** Activities (name + duration) are grouped into reusable sets. Different classes can use different sets, and multiple classes can share the same set with different start times.

## Usage

1. Open the app and click **⚙ Setup**.
2. Create an activity set (list of activities with durations in minutes).
3. Add classes: name, start time, duration (blank = sum of activities), and pick an activity set.
4. Leave the page open — each class starts on its own at its start time. Press **Next Activity** (or Space / → / N) to advance.

Handy extras: fullscreen button for projection, screen wake-lock so the display doesn't sleep, chime toggle, and Export/Import JSON to move your setup between computers (settings are stored in the browser's localStorage).

## Development

Plain HTML/CSS/JS — no build step. Open `index.html` in a browser, or serve the folder with any static server. Pushing to `main` deploys to GitHub Pages via the included workflow.
