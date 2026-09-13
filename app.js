'use strict';

/* ================= Storage ================= */

const CONFIG_KEY = 'classTimer.config.v1';
const RUNTIME_KEY = 'classTimer.runtime.v1';
const PREFS_KEY = 'classTimer.prefs.v1';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage full/blocked */ }
}

function defaultConfig() {
  const setId = uid();
  return {
    activitySets: [{
      id: setId,
      name: 'Standard Lesson',
      activities: [
        { id: uid(), name: 'Warm-up', min: 10 },
        { id: uid(), name: 'Lecture', min: 25 },
        { id: uid(), name: 'Group Activity', min: 15 },
        { id: uid(), name: 'Wrap-up', min: 10 },
      ],
    }],
    classes: [
      { id: uid(), name: 'Class A', start: '09:40', durationMin: 60, setId },
      { id: uid(), name: 'Class B', start: '10:50', durationMin: 60, setId },
      { id: uid(), name: 'Class C', start: '12:00', durationMin: 60, setId },
    ],
  };
}

let config = loadJSON(CONFIG_KEY) || defaultConfig();
let prefs = Object.assign(
  { sound: true, theme: 'dark', keepAwake: true, dimFs: false },
  loadJSON(PREFS_KEY),
);

// Per-class progress for today: { date, selected, byClass: { [classId]: { index, startedAt, done } } }
// index === -1 means the class hasn't started yet.
let runtime = loadJSON(RUNTIME_KEY);
if (!runtime || runtime.date !== todayKey()) {
  runtime = { date: todayKey(), selected: null, byClass: {} };
}

const saveConfig = () => saveJSON(CONFIG_KEY, config);
const saveRuntime = () => saveJSON(RUNTIME_KEY, runtime);
const savePrefs = () => saveJSON(PREFS_KEY, prefs);

/* ================= Model helpers ================= */

const $ = (sel) => document.querySelector(sel);

const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setFor(cls) {
  return config.activitySets.find((s) => s.id === cls.setId)
    || { id: '', name: '(no set)', activities: [] };
}

function startDate(cls) {
  const [h, m] = cls.start.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

// Days of the week (0=Sunday..6=Saturday) this class meets on. Undefined or
// empty means "every day" -- both the default for a brand-new class and the
// fallback for configs saved before this field existed.
function classDays(cls) {
  return (cls.days && cls.days.length) ? cls.days : [0, 1, 2, 3, 4, 5, 6];
}

function classMeetsOn(cls, date) {
  return classDays(cls).includes(date.getDay());
}

function classDurationMin(cls) {
  if (cls.durationMin && cls.durationMin > 0) return cls.durationMin;
  return setFor(cls).activities.reduce((sum, a) => sum + (a.min || 0), 0);
}

function classEndMs(cls) {
  return +startDate(cls) + classDurationMin(cls) * 60000;
}

// classEndMs() is pinned to the *scheduled* start. Once a class has actually
// begun, "how much time is left overall" needs to be measured from when it
// really started — otherwise starting even moderately late (manually, before
// or after the scheduled time) silently eats into the last activity's own
// budget, on top of whatever it absorbs from drift during the class itself.
function actualClassEndMs(cls, rt) {
  const actualStart = rt.starts && rt.starts[0] != null ? rt.starts[0] : +startDate(cls);
  return actualStart + classDurationMin(cls) * 60000;
}

// This class's scheduled start time on the same calendar day as `day`,
// regardless of whether `day` is actually one of its scheduled days.
function startOnDate(cls, day) {
  const [h, m] = cls.start.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return +d;
}

// The next scheduled start whose window hasn't already fully ended, at or
// after `afterMs` -- today (if not yet over), or the next day this class
// meets, however many days away that is. Replaces the old "just add a day"
// missed-class handling now that a class might only meet certain days.
function nextScheduledStart(cls, afterMs) {
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(afterMs);
    day.setDate(day.getDate() + offset);
    if (!classMeetsOn(cls, day)) continue;
    const startMs = startOnDate(cls, day);
    if (startMs + classDurationMin(cls) * 60000 > afterMs) return startMs;
  }
  return startOnDate(cls, new Date(afterMs)); // unreachable: classDays() is never empty
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "", "tomorrow ", or a day name, for phrasing "Starts ___ in".
function relativeDayLabel(targetMs, nowMs) {
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return +d; };
  const diffDays = Math.round((startOfDay(targetMs) - startOfDay(nowMs)) / 86400000);
  if (diffDays <= 0) return '';
  if (diffDays === 1) return 'tomorrow ';
  return `${DAY_NAMES[new Date(targetMs).getDay()]} `;
}

// Fits a run of planned durations (ms) into a total budget (ms). If the plan
// fits or comes up short, the surplus goes to the last item. If the plan
// overshoots the budget, the deficit is cut from the *last* item first, then
// the one before it, and so on — an activity only gives up time once every
// activity after it has already given up all of its own.
function cascadeDurations(plannedMs, budgetMs) {
  const durs = plannedMs.slice();
  if (!durs.length) return durs;
  const diff = budgetMs - durs.reduce((sum, d) => sum + d, 0);
  if (diff >= 0) {
    durs[durs.length - 1] += diff;
  } else {
    let remaining = -diff;
    for (let k = durs.length - 1; k >= 0 && remaining > 0; k--) {
      const cut = Math.min(durs[k], remaining);
      durs[k] -= cut;
      remaining -= cut;
    }
  }
  return durs;
}

function activityDurMs(cls, rt) {
  const acts = setFor(cls).activities;
  const a = acts[rt.index];
  if (!a) return 0;
  const adjust = (rt.adjusts && rt.adjusts[rt.index]) || 0;
  const tail = acts.slice(rt.index).map((x) => (x.min || 0) * 60000);
  const budget = actualClassEndMs(cls, rt) - rt.startedAt;
  const base = cascadeDurations(tail, budget)[0] || 0;
  // +time can grow this activity by eating later ones, but never past the
  // class's own end -- there is nothing further downstream left to give up.
  return Math.max(0, Math.min(base + adjust, budget));
}

// Planned duration of slot i, ignoring runtime drift (any shortfall between
// the class duration and the activities' own minutes cascades in from the
// end, same as a live overrun does).
function actPlannedMs(cls, i) {
  const acts = setFor(cls).activities;
  const durs = cascadeDurations(acts.map((a) => (a.min || 0) * 60000), classDurationMin(cls) * 60000);
  return durs[i] || 0;
}

// Projected clock window per activity plus overall drift (positive = behind
// plan). Past activities use their recorded actual starts; future ones are
// pushed out live while the current activity runs over.
function projectSchedule(cls, rt, now) {
  const acts = setFor(cls).activities;
  const n = acts.length;
  const win = new Array(n);
  if (!n) return { win, drift: 0 };

  const classEnd = actualClassEndMs(cls, rt);
  const planned = new Array(n + 1);
  let p = +startDate(cls);
  for (let i = 0; i < n; i++) { planned[i] = p; p += actPlannedMs(cls, i); }
  planned[n] = p;

  if (rt.index === -1) {
    for (let i = 0; i < n; i++) win[i] = { s: planned[i], e: planned[i] + actPlannedMs(cls, i) };
    return { win, drift: 0 };
  }

  const cur = Math.min(rt.index, n - 1);
  for (let i = 0; i <= cur; i++) {
    const s = rt.starts[i] ?? planned[i];
    let e;
    if (i < cur) e = rt.starts[i + 1] ?? s + actPlannedMs(cls, i);
    else if (rt.done) e = rt.finishedAt ?? s + actPlannedMs(cls, i);
    // Once overdue, the segment's own end keeps pace with real elapsed
    // time instead of staying pinned at its allocation — otherwise it
    // sits frozen at its original width while blinking, then jumps to
    // the true elapsed width all at once the moment you click Next.
    else e = rt.startedAt + Math.max(activityDurMs(cls, rt), now - rt.startedAt);
    win[i] = { s, e };
  }
  if (rt.done) return { win, drift: 0 };

  let cursor = Math.max(win[cur].e, now);
  if (cur + 1 < n) {
    const futureMin = acts.slice(cur + 1).map((a) => (a.min || 0) * 60000);
    const durs = cascadeDurations(futureMin, classEnd - cursor);
    for (let k = 0; k < durs.length; k++) {
      const i = cur + 1 + k;
      const dur = Math.max(0, durs[k]);
      win[i] = { s: cursor, e: cursor + dur };
      cursor += dur;
    }
  }
  const drift = cur + 1 < n
    ? win[cur + 1].s - planned[cur + 1]
    : Math.max(win[cur].e, now) - planned[n];
  return { win, drift };
}

function sortedClasses() {
  return [...config.classes].sort((a, b) => a.start.localeCompare(b.start));
}

function rtFor(classId) {
  if (!runtime.byClass[classId]) {
    runtime.byClass[classId] = { index: -1, startedAt: null, done: false, starts: {}, adjusts: {} };
  }
  const rt = runtime.byClass[classId];
  if (!rt.starts) rt.starts = {};   // runtimes saved by older versions
  if (!rt.adjusts) rt.adjusts = {};
  return rt;
}

function pickDefaultClass() {
  const now = Date.now();
  const today = new Date(now);
  const sorted = sortedClasses();
  const inProgress = sorted.find((c) => {
    if (!classMeetsOn(c, today)) return false;
    const s = +startDate(c);
    return now >= s && now < s + classDurationMin(c) * 60000;
  });
  if (inProgress) return inProgress.id;
  // Whichever class starts soonest, considering day-of-week -- may be later
  // today, tomorrow, or further out for a class that only meets some days.
  let best = null;
  let bestStart = Infinity;
  for (const c of sorted) {
    const next = nextScheduledStart(c, now);
    if (next < bestStart) { bestStart = next; best = c; }
  }
  return best ? best.id : null;
}

function currentClass() {
  if (!config.classes.length) return null;
  if (!runtime.selected || !config.classes.some((c) => c.id === runtime.selected)) {
    runtime.selected = pickDefaultClass();
    saveRuntime();
  }
  return config.classes.find((c) => c.id === runtime.selected) || null;
}

// Keep runtime consistent after config edits (deleted classes, shortened sets).
function sanitizeRuntime() {
  for (const id of Object.keys(runtime.byClass)) {
    const cls = config.classes.find((c) => c.id === id);
    if (!cls) { delete runtime.byClass[id]; continue; }
    const rt = runtime.byClass[id];
    const n = setFor(cls).activities.length;
    if (rt.index >= n) {
      if (n > 0) rt.index = n - 1;
      else { rt.index = -1; rt.done = true; }
    }
  }
  saveRuntime();
}

/* ================= Formatting ================= */

const pad = (n) => String(n).padStart(2, '0');

function fmtDur(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// A duration split into a main part and a seconds part meant to render
// smaller and top-aligned next to it (e.g. big "4" with a small "32"
// perched beside it) — shared by the big counter, activity durations, and
// the progress bar's boundary times so seconds always look the same way.
function durationSmallSecHTML(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const main = h ? `${h}:${pad(m)}` : `${m}`;
  return `${main}<span class="small-sec">${pad(s)}</span>`;
}

function renderBigDur(el, ms, prefix) {
  el.innerHTML = `${prefix || ''}${durationSmallSecHTML(ms)}`;
}

// The live clock, small-seconds styled like everything else. Built from
// Intl's formatToParts (rather than a hand-rolled 12-hour format) so the
// hour/minute/AM-PM stay locale-correct; only the "second" part and the
// literal separator immediately before it are touched.
function fmtClockSmallSecHTML(d) {
  const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }).formatToParts(d);
  let html = '';
  parts.forEach((p, i) => {
    if (p.type === 'literal' && parts[i + 1] && parts[i + 1].type === 'second') return;
    html += p.type === 'second' ? `<span class="small-sec">${p.value}</span>` : esc(p.value);
  });
  return html;
}

function fmt12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmt12Date(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Compact clock time without AM/PM, for the progress bar's boundary times
// (no seconds — those stay reserved for each activity's own duration).
function fmtHM(t) {
  const d = t instanceof Date ? t : new Date(t);
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())}`;
}

/* ================= Sound ================= */

let audioCtx = null;
const beeped = new Set(); // "classId:index" keys already chimed

function chime() {
  if (!prefs.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [0, 0.22].forEach((offset, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 880 : 1174.66;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.2);
    });
  } catch { /* audio unavailable */ }
}

/* ================= Wake lock (keep projector screen on) ================= */

let wakeLock = null;

async function ensureWakeLock() {
  if (!prefs.keepAwake) return;
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* not supported or denied */ }
}

function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch { /* noop */ }
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') ensureWakeLock();
});

/* ================= Rendering: class chips ================= */

function renderChips() {
  const nav = $('#class-chips');
  const cls = currentClass();
  const today = new Date();
  nav.innerHTML = sortedClasses().map((c) => {
    const rt = rtFor(c.id);
    const isLive = rt.index >= 0 && !rt.done;
    return `
    <button class="chip ${cls && c.id === cls.id ? 'active' : ''} ${classMeetsOn(c, today) ? '' : 'not-today'}" data-class="${c.id}">
      ${isLive ? '<span class="chip-live" title="Running now"></span>' : ''}
      <span>${esc(c.name)}</span><span class="chip-time">${fmt12(c.start)}</span>
    </button>`;
  }).join('');
}

/* ================= Rendering: main stage ================= */

// One bar for the whole class: segments are sized by each activity's planned
// share of the class duration; boundary times above them come from the live
// projected schedule so they reflect drift and ±adjustments.
function segBarHTML(cls) {
  const acts = setFor(cls).activities;
  if (!acts.length) return '';
  const durs = acts.map((a, i) => actPlannedMs(cls, i));
  const total = durs.reduce((s, d) => s + d, 0) || 1;

  const segs = acts.map((a, i) => {
    const pct = (durs[i] / total) * 100;
    return `
      <div class="seg" data-i="${i}" style="flex-basis:${pct.toFixed(3)}%">
        <div class="seg-fill" data-i="${i}"></div>
        <div class="seg-label"><div class="seg-name">${esc(a.name)}</div><div class="seg-dur" data-i="${i}">${durationSmallSecHTML(durs[i])}</div></div>
      </div>`;
  }).join('');

  let cum = 0;
  const bounds = [0];
  for (const d of durs) { cum += d; bounds.push(cum); }
  const times = bounds.map((b, i) => {
    const pct = (b / total) * 100;
    const edge = i === 0 ? 'start' : i === bounds.length - 1 ? 'end' : 'mid';
    return `<span class="seg-time ${edge}" data-i="${i}" style="left:${pct.toFixed(3)}%">—</span>`;
  }).join('');

  return `
    <div class="segbar-wrap">
      <div class="seg-times">${times}</div>
      <div class="segbar" id="segbar">${segs}</div>
    </div>`;
}

function renderStage() {
  const stage = $('#stage');
  const cls = currentClass();

  if (!cls) {
    stage.innerHTML = `
      <section class="card onboarding">
        <h2>Welcome to Class Timer</h2>
        <p>Add your classes and activities to get started.</p>
        <button id="btn-open-setup" class="btn primary">Open Setup</button>
      </section>`;
    $('#btn-open-setup').addEventListener('click', openSettings);
    return;
  }

  const rt = rtFor(cls.id);
  const acts = setFor(cls).activities;

  const head = `
    <div class="class-head">
      <div class="class-title-col">
        <div class="class-title">
          <h2 class="class-name" title="${esc(cls.name)}">${esc(cls.name)}</h2>
          <span class="class-window" id="class-window"></span>
        </div>
        <div class="class-drift" id="drift"></div>
      </div>
      <div class="now-inline" id="now-clock">—</div>
      <button id="btn-restart" class="icon-btn bordered" title="Restart this class from the beginning" ${rt.index === -1 && !rt.done ? 'disabled' : ''}>↺</button>
    </div>`;

  let body;
  if (rt.done) {
    body = `
      <div class="done">
        <div class="done-mark">✓</div>
        <div class="done-text">${esc(cls.name)} — all activities complete</div>
        ${segBarHTML(cls)}
        ${rt.index >= 0 ? '<button id="btn-back" class="btn ghost" title="Back to the last activity">◂ Back</button>' : ''}
      </div>`;
  } else if (rt.index === -1) {
    const nowMs = Date.now();
    const dayLabel = relativeDayLabel(nextScheduledStart(cls, nowMs), nowMs);
    body = `
      <div class="pre">
        <div class="mini-label">Starts ${dayLabel}in</div>
        <div class="big" id="pre-remaining">—</div>
        ${segBarHTML(cls)}
        ${acts.length ? `
        <div class="act-foot">
          <div class="foot-btns">
            <button id="btn-start-now" class="btn primary cta-circle" title="Start now" aria-label="Start now">▸</button>
          </div>
        </div>` : '<p class="muted">This class has no activities yet — add some in Setup.</p>'}
      </div>`;
  } else {
    const next = acts[rt.index + 1];
    const isLast = rt.index === acts.length - 1;
    body = `
      <div class="activity">
        <div class="mini-label"></div>
        <div class="counter-trio">
          <div class="trio-mid">
            <div class="big" id="act-remaining">—</div>
          </div>
          ${isLast ? '' : `
          <div class="class-time-small">
            <div class="cts-label">Left in class</div>
            <div class="cts-num" id="class-time-left">—</div>
          </div>`}
        </div>
        ${segBarHTML(cls)}
        <div class="act-foot">
          <div class="adjust">
            <button class="btn time-btn time-sub" data-adj="-60000" title="Take a minute off this activity (Shift+1)" aria-label="Take a minute off this activity"><span class="time-icon time-icon-sub"></span><span class="time-n">1</span></button>
            <button class="btn time-btn time-add" data-adj="60000" title="Give this activity one more minute (1)" aria-label="Give this activity one more minute"><span class="time-icon time-icon-add"></span><span class="time-n">1</span></button>
            <button class="btn time-btn time-add" data-adj="300000" title="Give this activity five more minutes (5, Shift+5 to subtract)" aria-label="Give this activity five more minutes"><span class="time-icon time-icon-add"></span><span class="time-n">5</span></button>
          </div>
          <div class="foot-btns">
            ${rt.index > 0 ? '<button id="btn-back" class="btn ghost" title="Back to the previous activity">◂ Back</button>' : ''}
            <button id="btn-next" class="btn primary cta-circle" title="${next ? 'Next Activity' : 'Finish Class'}" aria-label="${next ? 'Next Activity' : 'Finish Class'}">${next ? '▸' : '✓'}</button>
          </div>
        </div>
      </div>`;
  }

  stage.innerHTML = `<section class="card">${head}${body}</section>`;

  $('#btn-next')?.addEventListener('click', nextActivity);
  $('#btn-back')?.addEventListener('click', prevActivity);
  $('#btn-start-now')?.addEventListener('click', startNow);
  $('#btn-restart')?.addEventListener('click', restartClass);
  stage.querySelectorAll('[data-adj]').forEach((b) => {
    b.addEventListener('click', () => adjustCurrent(Number(b.dataset.adj)));
  });
  updateDynamic();
}

/* ================= Timer actions ================= */

function startNow() {
  const cls = currentClass();
  if (!cls) return;
  const rt = rtFor(cls.id);
  if (setFor(cls).activities.length) {
    rt.index = 0;
    rt.startedAt = Date.now();
    rt.starts[0] = rt.startedAt;
    delete rt.adjusts[0];
    beeped.delete(cls.id + ':0');
  } else {
    rt.done = true;
  }
  saveRuntime();
  renderChips(); // the chip's live dot should appear the instant this happens
  renderStage();
}

function nextActivity() {
  const cls = currentClass();
  if (!cls) return;
  const rt = rtFor(cls.id);
  const acts = setFor(cls).activities;
  if (rt.done) return;
  if (rt.index === -1) {
    startNow();
    return;
  }
  if (rt.index < acts.length - 1) {
    rt.index += 1;
    rt.startedAt = Date.now();
    rt.starts[rt.index] = rt.startedAt;
    delete rt.adjusts[rt.index]; // fresh run of this slot
    beeped.delete(cls.id + ':' + rt.index);
  } else {
    rt.done = true;
    rt.finishedAt = Date.now();
  }
  saveRuntime();
  renderChips(); // dot disappears once done
  renderStage();
}

function prevActivity() {
  const cls = currentClass();
  if (!cls) return;
  const rt = rtFor(cls.id);
  if (rt.done && rt.index >= 0) {
    rt.done = false;
    rt.finishedAt = null;
  } else if (rt.index > 0) {
    rt.index -= 1;
  } else {
    return;
  }
  // Restore the activity's original clock so its countdown resumes as if
  // the accidental advance never happened.
  rt.startedAt = rt.starts[rt.index] ?? Date.now();
  saveRuntime();
  renderChips(); // dot reappears if this un-did a "finish class"
  renderStage();
}

function adjustCurrent(ms) {
  const cls = currentClass();
  if (!cls) return;
  const rt = rtFor(cls.id);
  if (rt.index < 0 || rt.done) return;

  // Clamp the *stored* adjust the same way the displayed duration is
  // clamped, not just at display time. Otherwise a keyboard shortcut (which
  // isn't gated by the +buttons' disabled state) can bank an adjust far
  // past what's usable, and a later -press would appear to do nothing
  // because it's merely eating into that banked, already-clamped surplus.
  const acts = setFor(cls).activities;
  const tail = acts.slice(rt.index).map((x) => (x.min || 0) * 60000);
  const budget = actualClassEndMs(cls, rt) - rt.startedAt;
  const base = cascadeDurations(tail, budget)[0] || 0;
  const current = rt.adjusts[rt.index] || 0;
  rt.adjusts[rt.index] = Math.max(-base, Math.min(budget - base, current + ms));

  if (ms > 0) beeped.delete(cls.id + ':' + rt.index); // may chime again at the new end
  saveRuntime();
  updateDynamic();
}

function restartClass() {
  const cls = currentClass();
  if (!cls) return;
  const rt = rtFor(cls.id);
  if (rt.index === -1 && !rt.done) return; // nothing to restart before the class begins
  if (!confirm(`Restart "${cls.name}" from the beginning?`)) return;
  runtime.byClass[cls.id] = { index: -1, startedAt: null, done: false, starts: {}, adjusts: {} };
  for (const key of [...beeped]) {
    if (key.startsWith(cls.id + ':')) beeped.delete(key);
  }
  saveRuntime();
  renderChips(); // dot disappears
  renderStage();
}

/* ================= Tick loop ================= */

function tick() {
  // Date rollover (tab left open overnight).
  if (runtime.date !== todayKey()) {
    runtime = { date: todayKey(), selected: runtime.selected, byClass: {} };
    beeped.clear();
    saveRuntime();
    renderChips();
    renderStage();
    return;
  }

  const cls = currentClass();
  if (cls) {
    const rt = rtFor(cls.id);
    // Auto-start while the wall clock is inside the class window, on a day
    // this class actually meets. A class whose window already passed (or
    // that doesn't meet today at all) stays pending and counts down to its
    // next scheduled occurrence.
    const startMs = +startDate(cls);
    if (rt.index === -1 && !rt.done && classMeetsOn(cls, new Date())
      && Date.now() >= startMs && Date.now() < classEndMs(cls)) {
      const acts = setFor(cls).activities;
      if (acts.length) {
        rt.index = 0;
        rt.startedAt = startMs; // anchored to the schedule, even if the page opened late
        rt.starts[0] = startMs;
      } else {
        rt.done = true;
      }
      saveRuntime();
      renderChips(); // the chip's live dot should appear the instant this happens
      renderStage();
      return;
    }
  }
  updateDynamic();
}

function updateDynamic() {
  const nowClock = $('#now-clock'); // lives inside the card, absent on onboarding
  if (nowClock) nowClock.innerHTML = fmtClockSmallSecHTML(new Date());

  const cls = currentClass();
  if (!cls) {
    if (document.title !== 'Class Timer') document.title = 'Class Timer';
    return;
  }
  const rt = rtFor(cls.id);
  const now = Date.now();
  const start = +startDate(cls);
  const acts = setFor(cls).activities;
  let title = 'Class Timer';

  // Populated only while an activity is running; read by the segment loop
  // below so the current segment's fill matches the big counter exactly.
  let durMs = 0;
  let elapsed = 0;
  let warning = false;
  let overdue = false;

  if (rt.done) {
    title = `✓ ${cls.name}`;
  } else if (rt.index === -1) {
    // Counts down to the next time this class actually meets -- later
    // today, tomorrow, or further out if it skipped today entirely.
    const target = nextScheduledStart(cls, now);
    const preRem = $('#pre-remaining');
    if (preRem) renderBigDur(preRem, target - now);
    title = `in ${fmtDur(target - now)} · ${cls.name}`;
  } else if (acts[rt.index]) {
    durMs = activityDurMs(cls, rt);
    elapsed = now - rt.startedAt;
    const remaining = durMs - elapsed;
    overdue = remaining < 0;

    // +1/+5 can't add more once this activity already runs to the class's
    // end (nothing left downstream to take it from) — disable rather than
    // let clicks silently do nothing.
    const budget = actualClassEndMs(cls, rt) - rt.startedAt;
    const atCap = durMs >= budget - 500; // small slack for ms-level rounding
    document.querySelectorAll('#stage .time-add').forEach((b) => { b.disabled = atCap; });

    const big = $('#act-remaining');
    if (big) {
      if (!overdue) {
        // Amber "wrap it up" phase for roughly the last 15% of the activity,
        // clamped between 30 s and 2 min.
        const warnMs = Math.min(120000, Math.max(30000, durMs * 0.15));
        warning = remaining <= warnMs;
        renderBigDur(big, remaining);
        big.classList.remove('over');
        big.classList.toggle('warn', warning);
        title = `${fmtDur(remaining)} · ${acts[rt.index].name}`;
      } else {
        renderBigDur(big, -remaining, '+');
        big.classList.add('over');
        big.classList.remove('warn');
        title = `⏰ +${fmtDur(-remaining)} · ${acts[rt.index].name}`;
        const key = cls.id + ':' + rt.index;
        if (!beeped.has(key)) {
          beeped.add(key);
          chime();
        }
      }
    }
  }

  // Class window (start–end), next to the class name. Before the class
  // starts this is its next scheduled window (today's, or a future day's if
  // it doesn't meet today or already missed today's); once running or done,
  // it's the actual window, which can differ from scheduled once time is
  // added/lost.
  const windowEl = $('#class-window');
  if (windowEl) {
    const winStart = rt.index === -1 ? nextScheduledStart(cls, now) : (rt.starts[0] ?? start);
    const winEnd = rt.index === -1 ? winStart + classDurationMin(cls) * 60000 : actualClassEndMs(cls, rt);
    windowEl.textContent = `${fmt12Date(new Date(winStart))} – ${fmt12Date(new Date(winEnd))}`;
  }

  // Small "time left in class", off to the side of the (now centered,
  // full-size) activity counter — hidden on the last activity, since its
  // own countdown already IS the class's remaining time at that point.
  const classTimeEl = $('#class-time-left');
  if (classTimeEl) {
    const remain = actualClassEndMs(cls, rt) - now;
    renderBigDur(classTimeEl, Math.abs(remain), remain < 0 ? '+' : '');
    classTimeEl.classList.toggle('over', remain < 0);
  }

  // Segmented class bar: every segment's width and boundary position come
  // from the live projected schedule, not the original plan. Completed
  // segments use their real recorded duration; the last segment absorbs
  // whatever that leaves so the bar always spans exactly 0–100%. This is
  // why an activity ending early pushes everything after it left (and
  // widens the last segment), while ending late pushes things right (and
  // shrinks the last segment).
  if (acts.length) {
    const proj = projectSchedule(cls, rt, now);
    const n = acts.length;
    // Derive the 100% reference by summing the segments' own durations,
    // rather than measuring end-to-end from the schedule. While the current
    // activity is overdue, projectSchedule jumps its "cursor" for future
    // segments straight to `now`, leaving a gap between the current
    // segment's nominal end and the next one's start that isn't attributed
    // to any segment. Measuring total end-to-end would count that gap but
    // no segment would ever claim it, so the segments' widths would fall
    // short of 100% and leave an invisible void — which, sitting right
    // after the current segment, made the last segment look like it had
    // vanished. Summing the segments directly guarantees they always add
    // up to exactly 100%, gap or no gap.
    const durations = proj.win.map((w) => Math.max(0, w.e - w.s));
    const total = Math.max(1, durations.reduce((sum, d) => sum + d, 0));
    const cumPct = [0];
    durations.forEach((d) => cumPct.push(cumPct[cumPct.length - 1] + (d / total) * 100));

    document.querySelectorAll('#stage .seg-time').forEach((el) => {
      const i = Number(el.dataset.i);
      const t = i < n ? proj.win[i].s : proj.win[n - 1].e;
      el.textContent = Number.isFinite(t) ? fmtHM(t) : '—';
      el.style.left = cumPct[i].toFixed(3) + '%';
    });
    document.querySelectorAll('#stage .seg').forEach((seg) => {
      const i = Number(seg.dataset.i);
      const durationMs = durations[i];
      seg.style.flexBasis = (cumPct[i + 1] - cumPct[i]).toFixed(3) + '%';
      const dur = seg.querySelector('.seg-dur');
      if (dur) dur.innerHTML = durationSmallSecHTML(durationMs);
      const fill = seg.querySelector('.seg-fill');
      seg.classList.remove('done', 'current', 'warning', 'overdue');
      if (rt.done || (rt.index >= 0 && i < rt.index)) {
        seg.classList.add('done');
        fill.style.width = '100%';
      } else if (!rt.done && i === rt.index) {
        seg.classList.add('current');
        if (overdue) seg.classList.add('overdue');
        else if (warning) seg.classList.add('warning');
        fill.style.width = overdue
          ? '100%'
          : durMs > 0 ? Math.min(100, (elapsed / durMs) * 100).toFixed(2) + '%' : '100%';
      } else {
        fill.style.width = '0%';
      }
    });

    const driftEl = $('#drift');
    if (driftEl) {
      const mins = Math.round(proj.drift / 60000);
      driftEl.classList.remove('behind', 'ahead');
      if (rt.index >= 0 && !rt.done && Math.abs(mins) >= 1) {
        driftEl.textContent = `${Math.abs(mins)} min ${mins > 0 ? 'behind' : 'ahead'}`;
        driftEl.classList.add(mins > 0 ? 'behind' : 'ahead');
      } else {
        driftEl.textContent = '';
      }
    }
  }

  if (document.title !== title) document.title = title;
}

/* ================= Settings panel ================= */

function openSettings() {
  renderSettings();
  $('#settings-overlay').classList.remove('hidden');
}

function closeSettings() {
  $('#settings-overlay').classList.add('hidden');
}

function setOptionsHTML(selectedId) {
  return config.activitySets.map((s) =>
    `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}

function renderSettings() {
  const setsList = $('#sets-list');
  setsList.innerHTML = config.activitySets.map((s) => {
    const total = s.activities.reduce((sum, a) => sum + (a.min || 0), 0);
    return `
      <div class="set-card" data-set="${s.id}">
        <div class="set-head">
          <input class="in set-name" data-field="set-name" value="${esc(s.name)}" placeholder="Set name">
          <span class="set-total">${total} min total</span>
          <button class="icon-btn" data-action="del-set" title="Delete this set">✕</button>
        </div>
        <div class="acts">
          ${s.activities.map((a, i) => `
            <div class="act-row" data-act="${a.id}">
              <input class="in act-name" data-field="act-name" value="${esc(a.name)}" placeholder="Activity name">
              <input class="in act-min" data-field="act-min" type="number" min="1" value="${a.min}">
              <span class="unit">min</span>
              <button class="icon-btn" data-action="act-up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="icon-btn" data-action="act-down" title="Move down" ${i === s.activities.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="icon-btn" data-action="del-act" title="Remove activity">✕</button>
            </div>`).join('')}
        </div>
        <button class="btn small" data-action="add-act">+ Add activity</button>
      </div>`;
  }).join('') || '<p class="muted">No activity sets yet.</p>';

  const classesList = $('#classes-list');
  classesList.innerHTML = config.classes.map((c) => `
    <div class="class-row" data-class="${c.id}">
      <input class="in" data-field="cls-name" value="${esc(c.name)}" placeholder="Class name">
      <input class="in" data-field="cls-start" type="time" value="${c.start}">
      <input class="in" data-field="cls-dur" type="number" min="1" placeholder="auto" value="${c.durationMin ?? ''}" title="Class duration in minutes; leave blank to use the activity total">
      <select class="in" data-field="cls-set">${setOptionsHTML(c.setId)}</select>
      <button class="icon-btn" data-action="del-class" title="Remove class">✕</button>
      <div class="class-days">
        ${DAY_NAMES.map((name, day) => `
          <button type="button" class="day-btn${classDays(c).includes(day) ? ' active' : ''}" data-action="toggle-day" data-day="${day}" title="${name}">${name[0]}</button>`).join('')}
      </div>
    </div>`).join('') || '<p class="muted">No classes yet.</p>';
}

function refreshAfterConfigChange({ structural = false } = {}) {
  sanitizeRuntime();
  saveConfig();
  if (structural) renderSettings();
  renderChips();
  renderStage();
}

function handleSettingsClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const setEl = btn.closest('[data-set]');
  const actEl = btn.closest('[data-act]');
  const classEl = btn.closest('[data-class]');
  const set = setEl && config.activitySets.find((s) => s.id === setEl.dataset.set);
  const cls = classEl && config.classes.find((c) => c.id === classEl.dataset.class);

  if (action === 'add-act' && set) {
    set.activities.push({ id: uid(), name: 'New activity', min: 10 });
  } else if (action === 'del-act' && set && actEl) {
    set.activities = set.activities.filter((a) => a.id !== actEl.dataset.act);
  } else if ((action === 'act-up' || action === 'act-down') && set && actEl) {
    const i = set.activities.findIndex((a) => a.id === actEl.dataset.act);
    const j = action === 'act-up' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < set.activities.length) {
      [set.activities[i], set.activities[j]] = [set.activities[j], set.activities[i]];
    }
  } else if (action === 'del-set' && set) {
    if (!confirm(`Delete activity set "${set.name}"?`)) return;
    config.activitySets = config.activitySets.filter((s) => s.id !== set.id);
    const fallback = config.activitySets[0];
    config.classes.forEach((c) => {
      if (c.setId === set.id) c.setId = fallback ? fallback.id : '';
    });
  } else if (action === 'del-class' && classEl) {
    config.classes = config.classes.filter((c) => c.id !== classEl.dataset.class);
  } else if (action === 'toggle-day' && cls) {
    const day = Number(btn.dataset.day);
    const days = classDays(cls).slice();
    const idx = days.indexOf(day);
    if (idx >= 0) {
      if (days.length > 1) days.splice(idx, 1); // always keep at least one day
    } else {
      days.push(day);
    }
    cls.days = days.sort((a, b) => a - b);
  } else {
    return;
  }
  refreshAfterConfigChange({ structural: true });
}

function handleSettingsChange(e) {
  const input = e.target.closest('[data-field]');
  if (!input) return;
  const field = input.dataset.field;
  const setEl = input.closest('[data-set]');
  const actEl = input.closest('[data-act]');
  const classEl = input.closest('[data-class]');
  const set = setEl && config.activitySets.find((s) => s.id === setEl.dataset.set);
  const cls = classEl && config.classes.find((c) => c.id === classEl.dataset.class);
  const act = set && actEl && set.activities.find((a) => a.id === actEl.dataset.act);

  if (field === 'set-name' && set) set.name = input.value.trim() || 'Untitled set';
  else if (field === 'act-name' && act) act.name = input.value.trim() || 'Activity';
  else if (field === 'act-min' && act) act.min = Math.max(1, Math.round(Number(input.value) || 1));
  else if (field === 'cls-name' && cls) cls.name = input.value.trim() || 'Class';
  else if (field === 'cls-start' && cls) cls.start = input.value || cls.start;
  else if (field === 'cls-dur' && cls) {
    const v = Math.round(Number(input.value));
    cls.durationMin = v > 0 ? v : null;
  } else if (field === 'cls-set' && cls) cls.setId = input.value;
  else return;

  // Structural re-render only for fields that other parts of the panel display
  // (set names appear in class dropdowns; minutes feed the set total).
  const structural = field === 'set-name' || field === 'act-min';
  refreshAfterConfigChange({ structural });
}

/* ================= Import / export / reset ================= */

function exportData() {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'class-timer-config.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.activitySets) || !Array.isArray(data.classes)) {
        throw new Error('bad shape');
      }
      const okClasses = data.classes.every((c) => typeof c.start === 'string' && /^\d{1,2}:\d{2}$/.test(c.start));
      if (!okClasses) throw new Error('bad class start time');
      config = data;
      saveConfig();
      runtime = { date: todayKey(), selected: null, byClass: {} };
      saveRuntime();
      renderSettings();
      renderChips();
      renderStage();
    } catch {
      alert('That file is not a valid Class Timer export.');
    }
  };
  reader.readAsText(file);
}

function resetAllData() {
  if (!confirm('Delete ALL classes, activity sets, and progress? This cannot be undone.')) return;
  config = defaultConfig();
  runtime = { date: todayKey(), selected: null, byClass: {} };
  beeped.clear();
  saveConfig();
  saveRuntime();
  renderSettings();
  renderChips();
  renderStage();
}

/* ================= Top bar ================= */

function updateSoundButton() {
  $('#btn-sound').textContent = prefs.sound ? '🔔' : '🔕';
}

function applyTheme() {
  document.documentElement.classList.toggle('light', prefs.theme === 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = prefs.theme === 'light' ? '#eef1f7' : '#0b1020';
  const btn = $('#btn-theme');
  if (btn) btn.textContent = prefs.theme === 'light' ? '🌙' : '☀️';
}

function setTheme(theme) {
  prefs.theme = theme;
  savePrefs();
  applyTheme();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

/* ================= Init ================= */

function init() {
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-close-settings').addEventListener('click', closeSettings);
  $('#settings-overlay').addEventListener('click', (e) => {
    if (e.target === $('#settings-overlay')) closeSettings();
  });
  $('#panel-body').addEventListener('click', handleSettingsClick);
  $('#panel-body').addEventListener('change', handleSettingsChange);
  $('#btn-add-set').addEventListener('click', () => {
    config.activitySets.push({ id: uid(), name: 'New set', activities: [{ id: uid(), name: 'New activity', min: 10 }] });
    refreshAfterConfigChange({ structural: true });
  });
  $('#btn-add-class').addEventListener('click', () => {
    const fallback = config.activitySets[0];
    config.classes.push({ id: uid(), name: 'New class', start: '09:00', durationMin: null, setId: fallback ? fallback.id : '' });
    refreshAfterConfigChange({ structural: true });
  });
  $('#btn-export').addEventListener('click', exportData);
  $('#import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  $('#btn-reset-data').addEventListener('click', resetAllData);
  $('#btn-sound').addEventListener('click', () => {
    prefs.sound = !prefs.sound;
    savePrefs();
    updateSoundButton();
    if (prefs.sound) chime();
  });
  $('#btn-fullscreen').addEventListener('click', toggleFullscreen);
  $('#btn-theme').addEventListener('click', () => {
    setTheme(prefs.theme === 'light' ? 'dark' : 'light');
  });
  document.addEventListener('fullscreenchange', () => {
    document.body.classList.toggle('fs', !!document.fullscreenElement);
  });

  const optAwake = $('#opt-keep-awake');
  const optDim = $('#opt-dim-fs');
  optAwake.checked = prefs.keepAwake;
  optDim.checked = prefs.dimFs;
  optAwake.addEventListener('change', () => {
    prefs.keepAwake = optAwake.checked;
    savePrefs();
    if (prefs.keepAwake) ensureWakeLock();
    else releaseWakeLock();
  });
  optDim.addEventListener('change', () => {
    prefs.dimFs = optDim.checked;
    savePrefs();
    document.body.classList.toggle('dim-fs', prefs.dimFs);
  });

  $('#class-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-class]');
    if (!chip) return;
    runtime.selected = chip.dataset.class;
    saveRuntime();
    renderChips();
    renderStage();
  });

  // Shortcuts: Space / → / N / PageDown = next activity (presenter-remote
  // friendly), ← / PageUp = back, F = fullscreen, D = toggle theme,
  // 1-9 = add that many minutes to the current activity, Shift+1-9 =
  // subtract instead. Matched on e.code (physical digit-row/numpad key) so
  // it works the same regardless of keyboard layout or what Shift produces.
  document.addEventListener('keydown', (e) => {
    if (!$('#settings-overlay').classList.contains('hidden')) return;
    if (e.target.closest('input, select, textarea')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const onButton = !!e.target.closest('button');
    if ((k === ' ' && !onButton) || ['n', 'N', 'ArrowRight', 'PageDown'].includes(k)) {
      e.preventDefault();
      nextActivity();
    } else if (k === 'ArrowLeft' || k === 'PageUp') {
      e.preventDefault();
      prevActivity();
    } else if (k === 'f' || k === 'F') {
      toggleFullscreen();
    } else if (k === 'd' || k === 'D') {
      setTheme(prefs.theme === 'light' ? 'dark' : 'light');
    } else {
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (digit) {
        e.preventDefault();
        const mins = Number(digit[1]);
        adjustCurrent((e.shiftKey ? -1 : 1) * mins * 60000);
      }
    }
  });

  // Browsers require a user gesture before audio / wake lock.
  document.addEventListener('click', () => {
    ensureWakeLock();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  });

  sanitizeRuntime();
  applyTheme();
  document.body.classList.toggle('dim-fs', prefs.dimFs);
  updateSoundButton();
  renderChips();
  renderStage();
  ensureWakeLock();
  setInterval(tick, 250);
}

init();
