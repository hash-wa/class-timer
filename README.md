# Class Timer

A classroom timer for teachers, built for projecting during lessons.

**Live app:** https://hash-wa.github.io/class-timer/

## What it does

- **Auto-starts at class time, on the right days.** Configure one or more classes with preset start times (e.g. 9:40, 10:50, 12:00) and which days of the week each one meets — a Tuesday/Thursday class won't auto-start or show as "missed" on a Monday. When the wall clock reaches a class's start time on one of its scheduled days, its timer begins automatically — even if you open the page a few minutes late, it picks up in the right place. On a day it doesn't meet, the countdown points to its next scheduled day instead ("Starts Wednesday in...").
- **One segmented progress bar for the whole class, live.** The bar is divided into a segment per activity. Each segment shows the activity's name and its live duration (with seconds as a small top-aligned group) in its middle, and the boundary times between activities — also down to the second — sit above the bar. Running long or adding time cascades backward from the end of the class: the last activity gives up time first, and only once it's down to zero does the one before it start giving up time too, and so on — so the bar always keeps spanning the full class. Finishing early works the same way in reverse, growing the last activity. The current segment's own width also grows live if it runs over (instead of staying frozen at its planned size and jumping once you advance), fills as it runs, turns amber for the final stretch, and blinks when time is up (with an optional chime) until you press the round **▸** button — which you can also press early to move on ahead of schedule.
- **Big countdown, fixed in place and front and center.** The large countdown for the current (or next) activity always sits in the same spot, whether the class hasn't started, is running, or between activities, and shows its seconds as a smaller group whose top edge lines up exactly with the main digits' top edge (clock-style, e.g. big "4" with a small "32" perched beside it). While an activity runs, a small, muted countdown for how much time is left in the *whole class* sits off to the side — it disappears on the last activity, since that activity's own countdown already is the class's remaining time at that point. The live clock next to the class name is also fixed in place, centered on the header regardless of how long the class name is, and shows its own seconds the same small way.
- **Class window and drift.** Once a class starts, its actual start–end window appears right next to the class name, with a note underneath for how far ahead of or behind plan you are.
- **Stay on plan.** **◂ Back** (or ←) undoes an accidental advance and restores the previous activity's clock. The round **−1** (red) **/ +1 / +5** (green) time buttons — soft-tinted circles the same size as the Next Activity button, each with a clean drawn +/- icon and a small minute badge — or number keys **1-9** (add) and **Shift+1-9** (subtract) stretch or shave the current activity when class runs long, cascading the change through later activities the same way an overrun does. Adding time is always capped so the class can never run past its own end: the +1/+5 buttons grey out once there's nothing left to take, and the same cap applies to the keyboard shortcuts even though they aren't gated by a disabled button.
- **Activity sets.** Activities (name + duration) are grouped into reusable sets. Different classes can use different sets, and multiple classes can share the same set with different start times.

## Usage

1. Open the app and click **⚙ Setup**.
2. Create an activity set (list of activities with durations in minutes).
3. Add classes: name, start time, duration (blank = sum of activities), an activity set, and which days it meets (defaults to every day — tap a day letter to toggle it off).
4. Leave the page open — each class starts on its own at its start time on its scheduled days. Press **Next Activity** (or Space / → / N) to advance.

Once a class's window for one of its scheduled days has fully passed, the app counts down to its next scheduled occurrence instead of showing elapsed time. Classes not meeting today appear dimmed in the class-switcher chips.

Handy extras:

- Light and dark themes (toggle button, or the **D** key)
- Fullscreen for projection (**F** key) — hides everything but the timer card, which expands to fill nearly the whole screen, with an optional "dim the screen in fullscreen" setting
- "Keep screen on" option (screen wake-lock) so the display doesn't sleep mid-lesson
- End-of-activity chime toggle
- Keyboard shortcuts: Space / → / N = Next Activity, ← = Back (presenter remotes work: PageDown / PageUp), 1-9 = add that many minutes to the current activity, Shift+1-9 = subtract instead
- The browser tab title shows the live countdown, so the timer stays visible while you present other tabs
- Export/Import JSON to move your setup between computers (settings are stored in the browser's localStorage)

## Development

Plain HTML/CSS/JS — no build step. Open `index.html` in a browser, or serve the folder with any static server. Pushing to `main` deploys to GitHub Pages via the included workflow.
