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

function classDurationMin(cls) {
  if (cls.durationMin && cls.durationMin > 0) return cls.durationMin;
  return setFor(cls).activities.reduce((sum, a) => sum + (a.min || 0), 0);
}

function classEndMs(cls) {
  return +startDate(cls) + classDurationMin(cls) * 60000;
}

// True when today's class window has fully passed and the class was never run.
function isMissedToday(cls, rt) {
  return rt.index === -1 && !rt.done && Date.now() >= classEndMs(cls);
}

// The last activity stretches to the class end time when an explicit class
// duration is set; every other activity uses its own duration.
function fillsRest(cls, i) {
  return cls.durationMin > 0 && i === setFor(cls).activities.length - 1;
}

function activityDurMs(cls, rt) {
  const acts = setFor(cls).activities;
  const a = acts[rt.index];
  if (!a) return 0;
  if (fillsRest(cls, rt.index)) {
    return Math.max(0, +startDate(cls) + cls.durationMin * 60000 - rt.startedAt);
  }
  return a.min * 60000;
}

function sortedClasses() {
  return [...config.classes].sort((a, b) => a.start.localeCompare(b.start));
}

function rtFor(classId) {
  if (!runtime.byClass[classId]) {
    runtime.byClass[classId] = { index: -1, startedAt: null, done: false };
  }
  return runtime.byClass[classId];
}

function pickDefaultClass() {
  const now = Date.now();
  const sorted = sortedClasses();
  const inProgress = sorted.find((c) => {
    const s = +startDate(c);
    return now >= s && now < s + classDurationMin(c) * 60000;
  });
  if (inProgress) return inProgress.id;
  const upcoming = sorted.find((c) => +startDate(c) > now);
  const fallback = upcoming || sorted[sorted.length - 1];
  return fallback ? fallback.id : null;
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

function fmt12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmt12Date(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  nav.innerHTML = sortedClasses().map((c) => `
    <button class="chip ${cls && c.id === cls.id ? 'active' : ''}" data-class="${c.id}">
      <span>${esc(c.name)}</span><span class="chip-time">${fmt12(c.start)}</span>
    </button>`).join('');
}

/* ================= Rendering: main stage ================= */

function activityListHTML(cls, rt) {
  const acts = setFor(cls).activities;
  if (!acts.length) return '';
  return '<ol class="act-list">' + acts.map((a, i) => {
    let state = '';
    if (rt.done || (rt.index >= 0 && i < rt.index)) state = 'done';
    else if (!rt.done && i === rt.index) state = 'current';
    const minLabel = fillsRest(cls, i) ? 'rest of class' : `${a.min} min`;
    return `<li class="${state}"><span class="al-name">${esc(a.name)}</span><span class="al-min">${minLabel}</span></li>`;
  }).join('') + '</ol>';
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
  const start = startDate(cls);
  const end = new Date(+start + classDurationMin(cls) * 60000);

  const head = `
    <div class="class-head">
      <h2 class="class-name">${esc(cls.name)}</h2>
      <div class="class-side">
        <div class="class-progress dim">
          <div class="cp-labels">
            <span>${fmt12(cls.start)}</span>
            <span class="class-remaining" id="class-remaining">—</span>
            <span>${fmt12Date(end)}</span>
          </div>
          <div class="cp-bar"><div class="cp-fill" id="class-bar-fill"></div></div>
        </div>
        <button id="btn-restart" class="icon-btn bordered" title="Restart this class from the beginning">↺</button>
      </div>
    </div>`;

  let body;
  if (rt.done) {
    body = `
      <div class="done">
        <div class="done-mark">✓</div>
        <div class="done-text">${esc(cls.name)} — all activities complete</div>
      </div>`;
  } else if (rt.index === -1) {
    const missed = isMissedToday(cls, rt);
    body = `
      <div class="pre">
        <div class="pre-label">Starts at ${fmt12(cls.start)}${missed ? ' tomorrow' : ''} — in</div>
        <div class="big" id="pre-remaining">—</div>
        ${acts.length ? '<button id="btn-start-now" class="btn ghost">Start now</button>' : '<p class="muted">This class has no activities yet — add some in Setup.</p>'}
      </div>`;
  } else {
    const a = acts[rt.index];
    const next = acts[rt.index + 1];
    body = `
      <div class="activity">
        <div class="act-label">Activity ${rt.index + 1} of ${acts.length}</div>
        <div class="act-name">${esc(a.name)}</div>
        <div class="big" id="act-remaining">—</div>
        <div class="bar" id="bar"><div class="bar-fill" id="bar-fill"></div></div>
        <div class="act-foot">
          <span class="next-up">${next ? `Next: ${esc(next.name)} · ${fillsRest(cls, rt.index + 1) ? 'rest of class' : `${next.min} min`}` : 'Last activity'}</span>
          <button id="btn-next" class="btn primary">${next ? 'Next Activity ▸' : 'Finish Class ✓'}</button>
        </div>
      </div>`;
  }

  stage.innerHTML = `<section class="card">${head}${body}${activityListHTML(cls, rt)}</section>`;

  $('#btn-next')?.addEventListener('click', nextActivity);
  $('#btn-start-now')?.addEventListener('click', startNow);
  $('#btn-restart')?.addEventListener('click', restartClass);
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
  } else {
    rt.done = true;
  }
  saveRuntime();
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
  } else {
    rt.done = true;
  }
  saveRuntime();
  renderStage();
}

function restartClass() {
  const cls = currentClass();
  if (!cls) return;
  if (!confirm(`Restart "${cls.name}" from the beginning?`)) return;
  runtime.byClass[cls.id] = { index: -1, startedAt: null, done: false };
  for (const key of [...beeped]) {
    if (key.startsWith(cls.id + ':')) beeped.delete(key);
  }
  saveRuntime();
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
    // Auto-start while the wall clock is inside the class window. A class
    // whose window already passed stays pending and counts down to tomorrow.
    const startMs = +startDate(cls);
    if (rt.index === -1 && !rt.done && Date.now() >= startMs && Date.now() < classEndMs(cls)) {
      const acts = setFor(cls).activities;
      if (acts.length) {
        rt.index = 0;
        rt.startedAt = startMs; // anchored to the schedule, even if the page opened late
      } else {
        rt.done = true;
      }
      saveRuntime();
      renderStage();
      return;
    }
  }
  updateDynamic();
}

function updateDynamic() {
  $('#now-clock').textContent = new Date().toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });

  const cls = currentClass();
  if (!cls) return;
  const rt = rtFor(cls.id);
  const now = Date.now();
  const start = +startDate(cls);
  const end = start + classDurationMin(cls) * 60000;

  const classRem = $('#class-remaining');
  const classFill = $('#class-bar-fill');
  if (classRem && classFill) {
    if (now < start || isMissedToday(cls, rt)) {
      classRem.textContent = fmtDur(end - start);
      classRem.classList.remove('over');
      classFill.style.width = '0%';
    } else if (now <= end) {
      classRem.textContent = fmtDur(end - now);
      classRem.classList.remove('over');
      classFill.style.width = end > start
        ? (((now - start) / (end - start)) * 100).toFixed(2) + '%'
        : '100%';
    } else {
      classRem.textContent = '+' + fmtDur(now - end);
      classRem.classList.add('over');
      classFill.style.width = '100%';
    }
  }

  const preRem = $('#pre-remaining');
  if (preRem) {
    // A missed class counts down to tomorrow's start instead of showing
    // time elapsed since today's.
    const target = isMissedToday(cls, rt) ? start + 86400000 : start;
    preRem.textContent = fmtDur(target - now);
  }

  const acts = setFor(cls).activities;
  if (rt.index >= 0 && !rt.done && acts[rt.index]) {
    const durMs = activityDurMs(cls, rt);
    const elapsed = now - rt.startedAt;
    const remaining = durMs - elapsed;
    const big = $('#act-remaining');
    const bar = $('#bar');
    const fill = $('#bar-fill');
    if (!big || !bar || !fill) return;
    if (remaining >= 0) {
      big.textContent = fmtDur(remaining);
      big.classList.remove('over');
      bar.classList.remove('overdue');
      fill.style.width = durMs > 0
        ? Math.min(100, (elapsed / durMs) * 100).toFixed(2) + '%'
        : '100%';
    } else {
      big.textContent = '+' + fmtDur(-remaining);
      big.classList.add('over');
      bar.classList.add('overdue');
      fill.style.width = '100%';
      const key = cls.id + ':' + rt.index;
      if (!beeped.has(key)) {
        beeped.add(key);
        chime();
      }
    }
  }
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
  // friendly), F = fullscreen, D = dark mode, L = light mode.
  document.addEventListener('keydown', (e) => {
    if (!$('#settings-overlay').classList.contains('hidden')) return;
    if (e.target.closest('input, select, textarea')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const onButton = !!e.target.closest('button');
    if ((k === ' ' && !onButton) || ['n', 'N', 'ArrowRight', 'PageDown'].includes(k)) {
      e.preventDefault();
      nextActivity();
    } else if (k === 'f' || k === 'F') {
      toggleFullscreen();
    } else if (k === 'd' || k === 'D') {
      setTheme('dark');
    } else if (k === 'l' || k === 'L') {
      setTheme('light');
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
