import {
  analyze, tips, suggestDays, trimp, intensitySplit, addDays,
  DEFAULT_PLAN, INTENSITIES, SPORTS,
} from "./analysis.js";
import { demoData } from "./demo.js";
import { pmcChart, weekChart, sparkline, lineChart, stackedBars } from "./charts.js";
import { connectHeartRate } from "./bluetooth.js";
import { parseFitFile, loadFitSdk } from "./fit-import.js";
import * as I from "./insights.js";
import { buildWorkout, toGarminWorkout, encodeFitWorkout, totalSeconds } from "./workouts.js";
import * as P from "./period.js";
import * as SC from "./stats-charts.js";
import { cite } from "./sources.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d).replace(".", ",").replace(/^-/, "−") : "–");
const signed = (x, d = 1) => (Number.isFinite(x) ? `${x > 0 ? "+" : ""}${num(x, d)}` : "–");
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)} %` : "–");
const cites = (src) => [].concat(src || []).map(cite).join(" ");
const fmtDay = (k, opts = { weekday: "short", day: "2-digit", month: "2-digit" }) =>
  new Date(`${k}T12:00:00`).toLocaleDateString("de-DE", opts);
const fmtDuration = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h` : `${m} min`;
};

// ---------- Speicher (lokal, optional) ----------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`training.${key}`);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`training.${key}`, JSON.stringify(value));
    } catch {
      /* privater Modus: Daten gelten nur für diese Sitzung */
    }
  },
};

const state = {
  server: false,
  data: null,
  plan: store.get("plan", DEFAULT_PLAN),
  profileOverrides: store.get("profile", {}),
  imported: store.get("imported", []),
  analysis: null,
  selectedDay: 0,
  tab: store.get("tab", "overview"),
  period: { mode: store.get("periodMode", "week"), anchor: null },
  ble: null,
  live: [],
  recording: null,
};

function toast(msg, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), ms);
}

// ---------- Laden ----------

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  if (!isJson) throw new Error("kein API-Server");
  const body = await res.json();
  return { ok: res.ok, body };
}

async function load() {
  try {
    const { ok, body } = await fetchJson("api/data");
    state.server = true;
    state.data = ok ? body : demoData();
  } catch {
    state.data = demoData();
  }
  if (state.server) {
    try {
      const { ok, body } = await fetchJson("api/plan");
      if (ok) state.plan = body;
    } catch { /* lokaler Plan bleibt */ }
  }
  render();
}

function mergedData() {
  const seen = new Set();
  const activities = [...state.data.activities, ...state.imported]
    .filter((a) => {
      const key = a.start.slice(0, 16);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  return {
    ...state.data,
    profile: { ...state.data.profile, ...state.profileOverrides },
    activities,
  };
}

// ---------- Darstellung ----------

function render() {
  const data = mergedData();
  const a = analyze(data);
  state.analysis = a;
  state.activities = data.activities;
  const days = suggestDays(a, state.plan);
  state.days = days;

  renderHeader(data, a, days[0]);
  renderKpis(a);
  renderDays(days);
  pmcChart($("#pmc-chart"), a.model);
  $("#pmc-note").innerHTML = `Fitness = 42-Tage-, Ermüdung = 7-Tage-Mittel der Belastung; Form = Fitness − Ermüdung. ${cite("banister")}`;
  weekChart($("#week-chart"), a.weeks);
  renderDistribution(a);
  renderTips(a, data);
  renderActivities(data.activities, a.profile);
  renderLast7(data, a);
  renderTraining(data, a);
  renderRecovery(data, a);
  renderPatterns(data, a);
  renderWorkouts();
  renderSidebar(data, a);
  renderStats(data, a);
  applyTabHeader(a, days[0]);
  state.merged = data;
}

function renderHeader(data, a, today) {
  const h = new Date().getHours();
  const hello = h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
  const name = data.profile?.name && data.source !== "demo" ? `, ${data.profile.name.split(" ")[0]}` : "";
  state.greeting = `${hello}${name}`;

  const badge = $("#source-badge");
  if (data.source === "garmin") {
    badge.textContent = `Garmin Connect verbunden · ${new Date(data.syncedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`;
  } else {
    badge.textContent = state.imported.length ? `Beispieldaten + ${state.imported.length} importiert` : "Beispieldaten";
  }
  $("#footer").innerHTML = `Die Empfehlungen sind trainingswissenschaftlich begründete Richtwerte und ersetzen keine ärztliche oder trainerische Beratung. Maximalpuls: ${a.profile.hrMax} bpm (${a.profile.hrMaxSource}${a.profile.hrMaxSource === "Tanaka-Formel" ? `, ${cite("tanaka")}` : ""}), Ruhepuls: ${a.profile.hrRest} bpm. Live-Puls: ${cite("bleHr")} · FIT-Import: ${cite("fit")}`;
}

const TAB_TITLES = {
  training: ["Training", "Belastung, VO2max und Effizienz"],
  recovery: ["Erholung", "Schlaf, HRV und Vitalwerte"],
  patterns: ["Muster", "Frühwarnung und Zusammenhänge"],
  workouts: ["Workouts", "Strukturierte Einheiten für deine Uhr"],
};

function applyTabHeader(a, today) {
  $("#period-bar").hidden = state.tab !== "stats";
  if (state.tab === "stats") return; // setzt renderStats
  if (state.tab === "overview") {
    $("#headline").textContent = state.greeting;
    const what = today.intensity === "rest" ? "Ruhetag" : `${today.title || SPORTS[today.sport]} · ${INTENSITIES[today.intensity]} · ${today.durationMin} min`;
    $("#subline").textContent = `Heute empfohlen: ${what}`;
    return;
  }
  [$("#headline").textContent, $("#subline").textContent] = TAB_TITLES[state.tab];
}

function kpi({ label, value, note, status, statusText, extra = "" }) {
  return `<div class="card kpi">${extra}
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    ${status ? `<div class="status"><span class="dot ${status}"></span>${statusText}</div>` : ""}
    <div class="kpi-note">${note}</div>
  </div>`;
}

function renderKpis(a) {
  const r = a.readiness;
  const rStatus = { good: ["good", "Bereit für Belastung"], normal: ["warn", "Normal belastbar"], low: ["critical", "Erholung empfohlen"], unknown: ["", ""] }[r.status];
  const ringColor = { good: "var(--good)", normal: "var(--warn)", low: "var(--critical)" }[r.status] || "var(--axis)";

  const tsb = a.tsb;
  const tsbStatus = tsb > 5 ? ["good", "Ausgeruht"] : tsb > -10 ? ["good", "Ausgeglichen"] : tsb > -30 ? ["warn", "Produktiv belastet"] : ["critical", "Überlastet"];
  const week = a.model[a.model.length - 8];
  const ctlDelta = week ? a.ctl - week.ctl : 0;
  const ratio = a.acwr;
  const ratioStatus = !Number.isFinite(ratio) ? ["", ""] : ratio > 1.5 ? ["critical", "Zu schneller Anstieg"] : ratio > 1.3 ? ["serious", "Erhöht"] : ratio >= 0.8 ? ["good", "Optimaler Bereich"] : ["warn", "Unter Niveau"];

  $("#kpis").innerHTML = [
    kpi({
      label: "Bereitschaft",
      value: r.score ?? "–",
      status: rStatus[0], statusText: rStatus[1],
      note: `${r.reasons[0] ? esc(r.reasons[0].split(" (")[0]) : "Keine Erholungswerte"} · ${cite("plews")}`,
      extra: r.score != null ? `<div class="ring" style="--v:${r.score};--ring-color:${ringColor}" aria-hidden="true"><span>${r.score}</span></div>` : "",
    }),
    kpi({ label: "Form (TSB)", value: num(tsb), status: tsbStatus[0], statusText: tsbStatus[1], note: `Training Stress Balance · ${cite("banister")}` }),
    kpi({ label: "Fitness (CTL)", value: num(a.ctl), note: `${ctlDelta >= 0 ? "+" : ""}${num(ctlDelta, 1)} ggü. Vorwoche · Chronic Training Load` }),
    kpi({ label: "Ermüdung (ATL)", value: num(a.atl), note: "Acute Training Load, 7 Tage" }),
    kpi({
      label: "Wochen-Readiness",
      value: a.weeklyReadiness?.score ?? "–",
      status: a.weeklyReadiness ? { good: "good", normal: "warn", low: "critical" }[a.weeklyReadiness.status] : "",
      statusText: a.weeklyReadiness ? { good: "Gut erholt", normal: "Mittel", low: "Erholungsdefizit" }[a.weeklyReadiness.status] : "",
      note: "Ø der letzten 7 Tage aus HRV, Schlaf und Trainingsstress",
    }),
    kpi({ label: "Belastungsverhältnis", value: num(ratio, 2), status: ratioStatus[0], statusText: ratioStatus[1], note: `ACWR (Acute:Chronic Workload Ratio) · ${cite("gabbett")}` }),
  ].join("");
}

const INTENSITY_LEVEL = { rest: 0, easy: 25, long: 45, moderate: 65, hard: 90, race: 100 };

function renderDays(days) {
  $("#plan-sub").textContent = state.plan.raceDate
    ? `${state.plan.goal || "Wettkampf"} am ${fmtDay(state.plan.raceDate, { day: "2-digit", month: "long", year: "numeric" })}`
    : `Basis: dein Wochenplan${state.plan.goal ? ` · Ziel: ${state.plan.goal}` : ""}`;
  $("#days").innerHTML = days.map((d, i) => `
    <button class="day${i === 0 ? " today" : ""}" data-i="${i}" aria-expanded="${i === state.selectedDay}">
      <span class="day-date">${i === 0 ? "Heute" : i === 1 ? "Morgen" : fmtDay(d.date)}</span>
      <span class="day-title">${esc(d.intensity === "rest" ? "Ruhetag" : d.title || SPORTS[d.sport])}</span>
      <span class="day-meta">${d.intensity === "rest" ? "Erholung" : `${SPORTS[d.sport]} · ${d.durationMin} min`}</span>
      <div class="intensity-bar" title="Intensität: ${INTENSITIES[d.intensity]}"><div style="width:${INTENSITY_LEVEL[d.intensity]}%"></div></div>
      <span class="chip${d.changed ? " changed" : ""}">${INTENSITIES[d.intensity]}${d.changed ? " · angepasst" : ""}</span>
    </button>`).join("");
  renderDayDetail();
}

function renderDayDetail() {
  const d = state.days[state.selectedDay];
  const p = d.planned;
  const planned = p.intensity === "rest" ? "Ruhetag" : `${esc(p.title)} · ${INTENSITIES[p.intensity]} · ${p.durationMin} min`;
  $("#day-detail").innerHTML = `<div class="day-detail">
    <h3>${fmtDay(d.date, { weekday: "long", day: "numeric", month: "long" })}: ${esc(d.intensity === "rest" ? "Ruhetag" : d.title)}</h3>
    <div>${d.stimulus.text} ${d.stimulus.source ? cite(d.stimulus.source) : ""}</div>
    <ul>
      <li>Geplant: ${planned}${d.changed ? ` → empfohlen: ${INTENSITIES[d.intensity]} · ${d.durationMin} min` : " – passt zu deinem aktuellen Zustand"}</li>
      ${d.notes.map((n) => `<li>${n.text} ${cite(n.source)}</li>`).join("")}
    </ul>
  </div>`;
}

function renderDistribution(a) {
  const [low, mod, high] = a.distribution.share;
  const z = a.zones;
  const pct = (x) => `${Math.round(x * 100)} %`;
  const hours = a.distribution.seconds.map((s) => fmtDuration(s));
  if (!a.distribution.total) {
    $("#distribution").innerHTML = `<p class="hint">Noch keine Ausdauereinheiten mit Puls in den letzten 4 Wochen.</p>`;
    return;
  }
  $("#distribution").innerHTML = `
    <div class="dist-bar" role="img" aria-label="Locker ${pct(low)}, moderat ${pct(mod)}, intensiv ${pct(high)}">
      <div style="width:${low * 100}%;background:var(--int-low)" title="Locker ${pct(low)}"></div>
      <div style="width:${mod * 100}%;background:var(--int-mod)" title="Moderat ${pct(mod)}"></div>
      <div style="width:${high * 100}%;background:var(--int-high)" title="Intensiv ${pct(high)}"></div>
    </div>
    <div class="dist-rows">
      <div><span class="dot" style="background:var(--int-low)"></span>Locker · unter ${z.low[1]} bpm<strong>${pct(low)} · ${hours[0]}</strong></div>
      <div><span class="dot" style="background:var(--int-mod)"></span>Moderat · ${z.moderate[0]}–${z.moderate[1]} bpm<strong>${pct(mod)} · ${hours[1]}</strong></div>
      <div><span class="dot" style="background:var(--int-high)"></span>Intensiv · über ${z.high[0]} bpm<strong>${pct(high)} · ${hours[2]}</strong></div>
    </div>
    <p class="target">Orientierung: rund 80 % locker, 20 % moderat und intensiv (polarisiertes Training). ${cite("seiler")}</p>`;
}

function renderTips(a, data) {
  const list = [...I.insightTips(data, a), ...tips(a)];
  const level = { warn: "critical", info: "info", good: "good" };
  $("#tips").innerHTML = list.length
    ? list.map((t) => `<div class="tip"><span class="dot ${level[t.level]}"></span><div class="tip-title">${t.title}</div><div class="tip-text">${t.text} ${cites(t.source)}</div></div>`).join("")
    : `<p class="hint">Alles im grünen Bereich – weiter so.</p>`;
}

const SPORT_ICON = {
  run: '<path d="M13 4a2 2 0 1 0 0-.01M7 21l3-6 3 2v4M9 11l3-3 3 3 3 1M10 15l-2-4"/>',
  bike: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-7h5l3 7M10 9l2 7"/>',
  swim: '<path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M8 13l4-5 5 4"/>',
  strength: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
  default: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
};

function renderActivities(activities, p) {
  const recent = activities.slice(-12).reverse();
  $("#act-count").textContent = `${activities.length} Aktivitäten geladen`;
  $("#activities").innerHTML = `
    <thead><tr><th>Datum</th><th>Aktivität</th><th>Dauer</th><th>Distanz</th><th>Ø Puls</th><th>Belastung</th><th>TE aerob/anaerob</th><th>Schwerpunkt</th></tr></thead>
    <tbody>${recent.map((act) => {
      const split = intensitySplit(act, p);
      const total = split[0] + split[1] + split[2] || 1;
      const main = split[2] / total >= 0.15 ? "Intensiv" : split[1] / total >= 0.25 ? "Moderat" : "Locker";
      return `<tr>
        <td>${fmtDay(act.start.slice(0, 10))}</td>
        <td class="name"><span class="sport-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SPORT_ICON[act.sport] || SPORT_ICON.default}</svg></span>${esc(act.name)}</td>
        <td>${fmtDuration(act.durationSec)}</td>
        <td>${act.distanceM ? `${num(act.distanceM / 1000, 1)} km` : "–"}</td>
        <td>${act.avgHr ? `${act.avgHr} bpm` : "–"}</td>
        <td>${Math.round(trimp(act, p))}${act.trainingLoad ? `<span class="sub">Garmin ${act.trainingLoad}</span>` : ""}</td>
        <td>${act.aerobicTE != null ? `${num(act.aerobicTE, 1)} / ${num(act.anaerobicTE ?? 0, 1)}` : "–"}</td>
        <td>${act.avgHr || act.intensitySec ? main : "–"}</td>
      </tr>`;
    }).join("")}</tbody>`;
}

// ---------- Übersicht: letzte 7 Tage ----------

const HRV_STATUS = { BALANCED: ["good", "ausgeglichen"], UNBALANCED: ["warn", "unausgeglichen"], LOW: ["serious", "niedrig"], POOR: ["critical", "schlecht"] };
const scoreDot = (v) => (v == null ? "" : `<span class="dot ${v >= 70 ? "good" : v >= 50 ? "warn" : "critical"}"></span>`);

function renderLast7(data, a) {
  const rows = I.last7Days(data, a);
  const hasGarminLoad = rows.some((r) => r.garminLoad);
  $("#last7").innerHTML = `
    <thead><tr><th>Tag</th><th class="num">Schlaf</th><th class="num">Score</th><th class="num">Tief / REM</th><th class="num">HRV</th><th class="num">Ruhepuls</th><th class="num">Body Battery</th><th class="num">Belastung</th><th>Training</th><th class="num">Readiness</th></tr></thead>
    <tbody>${rows.map((r) => {
      const st = HRV_STATUS[r.hrvStatus];
      return `<tr>
        <td>${r.date === a.todayKey ? "Heute" : fmtDay(r.date)}</td>
        <td class="num">${r.sleepHours ? `${num(r.sleepHours, 1)} h` : "–"}</td>
        <td class="num">${r.sleepScore != null ? `${scoreDot(r.sleepScore)} ${r.sleepScore}` : "–"}</td>
        <td class="num">${r.deepPct != null ? `${pct(r.deepPct)} / ${pct(r.remPct)}` : "–"}</td>
        <td class="num">${r.hrv ? `${r.hrv} ms` : "–"}${st ? `<span class="sub"><span class="dot ${st[0]}"></span> ${st[1]}</span>` : ""}</td>
        <td class="num">${r.restingHr ? `${r.restingHr} bpm` : "–"}</td>
        <td class="num">${r.bodyBattery ?? "–"}</td>
        <td class="num">${Math.round(r.trimp)}${hasGarminLoad && r.garminLoad ? `<span class="sub">Garmin ${r.garminLoad}</span>` : ""}</td>
        <td>${r.sessions.length ? esc(r.sessions.join(", ")) : '<span class="sub">Ruhetag</span>'}</td>
        <td class="num">${r.readiness != null ? `${scoreDot(r.readiness)} ${r.readiness}` : "–"}</td>
      </tr>`;
    }).join("")}</tbody>`;
  const w = a.weeklyReadiness;
  $("#week-readiness-note").textContent = w ? `Wochen-Readiness ${w.score}/100` : "";
  $("#last7-note").innerHTML = `Belastung = TRIMP (Training Impulse) ${cite("banister")}${hasGarminLoad ? ", darunter Garmins eigene Trainingslast" : ""}. Readiness = HRV 40 %, Schlaf 35 %, akuter Trainingsstress 25 % ${cite("plews")}`;
}

// ---------- Training ----------

function renderTraining(data, a) {
  const v = I.vo2maxTrend(data, a.todayKey);
  if (v) {
    const delta = (x) => (x == null ? "–" : `<span class="${x >= 0 ? "delta-up" : "delta-down"}">${signed(x)}</span>`);
    $("#vo2-stats").innerHTML = `
      <div><strong>${num(v.latest, 1)}</strong><span>ml/kg/min aktuell</span></div>
      <div><strong>${delta(v.delta28)}</strong><span>4 Wochen</span></div>
      <div><strong>${delta(v.delta84)}</strong><span>12 Wochen</span></div>`;
    $("#vo2-sub").textContent = "Schätzung der Uhr";
    lineChart($("#vo2-chart"), v.series.map((x) => ({ date: x.date, value: x.vo2max })), { label: "VO2max", decimals: 1 });
  } else {
    $("#vo2-stats").innerHTML = "";
    $("#vo2-chart").innerHTML = '<p class="hint">Keine VO2max-Werte vorhanden (nach Synchronisation mit Garmin Connect verfügbar).</p>';
  }

  const g = I.garminLoad(state.activities, a.todayKey);
  const rowFor = (label, acute, chronic, ratio, note) => `<tr><td>${label}<span class="sub">${note}</span></td><td class="num">${Math.round(acute)}</td><td class="num">${Math.round(chronic)}</td><td class="num">${num(ratio, 2)}</td></tr>`;
  const trimpAcute = a.fullModel.slice(-7).reduce((s, d) => s + d.load, 0);
  const trimpChronic = a.fullModel.slice(-28).reduce((s, d) => s + d.load, 0) / 4;
  $("#load-table").innerHTML = `<thead><tr><th>Maß</th><th class="num">Akut</th><th class="num">Chronisch (Ø Woche)</th><th class="num">Verhältnis</th></tr></thead><tbody>
    ${rowFor("TRIMP", trimpAcute, trimpChronic, a.acwr, "pulsbasiert")}
    ${g ? rowFor("Garmin-Trainingslast", g.acute, g.chronic, g.ratio, "EPOC-basiert, von der Uhr") : ""}
    <tr><td>Form (TSB)<span class="sub">Fitness − Ermüdung</span></td><td class="num" colspan="3">${num(a.tsb)}</td></tr>
    <tr><td>Monotonie<span class="sub">Ø / SD der Tageslast, 7 Tage</span></td><td class="num" colspan="3">${num(a.monotony, 2)}</td></tr></tbody>`;
  $("#load-note").innerHTML = `Verhältnis 0,8–1,3 gilt als günstiger Bereich, über 1,5 steigt das Verletzungsrisiko ${cite("gabbett")}. Monotonie über 2 gilt als Risikofaktor ${cite("foster")}.`;

  const te = I.trainingEffects(state.activities, a.todayKey);
  $("#te-table").innerHTML = te
    ? `<thead><tr><th>Kennzahl</th><th class="num">Aerob</th><th class="num">Anaerob</th></tr></thead><tbody>
      <tr><td>Ø Trainingseffekt (0–5)</td><td class="num">${num(te.aerobic, 1)}</td><td class="num">${num(te.anaerobic, 1)}</td></tr>
      <tr><td>Einheiten mit verbessernder Wirkung</td><td class="num">${te.aerobicImproving} (≥ 3,0)</td><td class="num">${te.anaerobicImproving} (≥ 2,0)</td></tr>
      <tr><td>Einheiten im Überlastbereich (≥ 4,5)</td><td class="num" colspan="2">${te.overreaching} von ${te.count}</td></tr></tbody>`
    : "";
  $("#te-note").innerHTML = te
    ? "Trainingseffekt nach Garmins eigener Skala (0 = kein Effekt, 5 = überlastend). Anaerobe Reize entstehen v. a. durch kurze, harte Intervalle."
    : '<span class="hint">Keine Trainingseffekt-Werte vorhanden (nach Synchronisation mit Garmin Connect verfügbar).</span>';

  const eff = I.runEfficiency(state.activities, a.profile, a.todayKey);
  const paceFmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")} /km`;
  if (eff) {
    const col = (b) => (b ? [paceFmt(b.pace), `${Math.round(b.hr)} bpm`, num(b.ef, 2), b.n] : ["–", "–", "–", 0]);
    const [n, p] = [col(eff.now), col(eff.before)];
    $("#eff-table").innerHTML = `<thead><tr><th>Kennzahl</th><th class="num">Letzte 4 Wochen</th><th class="num">4 Wochen davor</th></tr></thead><tbody>
      <tr><td>Ø Pace</td><td class="num">${n[0]}</td><td class="num">${p[0]}</td></tr>
      <tr><td>Ø Herzfrequenz</td><td class="num">${n[1]}</td><td class="num">${p[1]}</td></tr>
      <tr><td>Effizienz<span class="sub">Meter pro Minute je Herzschlag</span></td><td class="num">${n[2]}</td><td class="num">${p[2]}</td></tr>
      <tr><td>Läufe</td><td class="num">${n[3]}</td><td class="num">${p[3]}</td></tr></tbody>`;
    $("#eff-note").textContent = eff.change != null
      ? `Effizienz ${eff.change >= 0 ? "gestiegen" : "gesunken"}: ${signed(eff.change * 100)} %. Steigende Werte bedeuten: gleiches Tempo bei niedrigerem Puls.`
      : "Für einen Vergleich fehlen Läufe aus den Vorwochen.";
  } else {
    $("#eff-table").innerHTML = "";
    $("#eff-note").textContent = "Keine lockeren Läufe mit Pace und Puls in den letzten 4 Wochen.";
  }
}

// ---------- Regeneration ----------

const STAGES = [
  { key: "deep", label: "Tiefschlaf", color: "var(--stage-deep)" },
  { key: "light", label: "Leichtschlaf", color: "var(--stage-light)" },
  { key: "rem", label: "REM", color: "var(--stage-rem)" },
  { key: "awake", label: "Wach", color: "var(--stage-awake)" },
];

function renderRecovery(data, a) {
  const daily = data.daily || [];
  const s = I.sleepArchitecture(daily, a.todayKey);
  if (s) {
    stackedBars($("#sleep-chart"), s.nights.map((d) => ({ date: d.date, values: d.sleepStages })), STAGES);
    $("#sleep-table").innerHTML = `<thead><tr><th>Ø Schlaf</th><th class="num">Dauer</th><th class="num">Tiefschlaf</th><th class="num">REM</th></tr></thead><tbody>
      <tr><td>Letzte 7 Nächte</td><td class="num">${num(s.last7.hours, 1)} h</td><td class="num">${pct(s.last7.deep)}</td><td class="num">${pct(s.last7.rem)}</td></tr>
      <tr><td>Dein 4-Wochen-Mittel</td><td class="num">${num(s.avg.hours, 1)} h</td><td class="num">${pct(s.avg.deep)}</td><td class="num">${pct(s.avg.rem)}</td></tr></tbody>`;
  } else {
    $("#sleep-chart").innerHTML = '<p class="hint">Keine Schlafphasen vorhanden (nach Synchronisation mit Garmin Connect verfügbar).</p>';
    $("#sleep-table").innerHTML = "";
  }

  const hrvSeries = daily.filter((d) => d.hrv && d.date >= addDays(a.todayKey, -27)).map((d) => ({ date: d.date, value: d.hrv }));
  const latest = daily.filter((d) => d.hrv).at(-1);
  const band = latest?.hrvBaseline;
  lineChart($("#hrv-chart"), hrvSeries, { label: "HRV", unit: " ms", band, color: "var(--series-1)" });
  const st = HRV_STATUS[latest?.hrvStatus];
  $("#hrv-sub").textContent = latest ? `Status: ${st ? st[1] : "–"}${latest.hrvWeeklyAvg ? ` · 7-Tage-Ø ${latest.hrvWeeklyAvg} ms` : ""}` : "";
  $("#hrv-note").innerHTML = `${band ? "Fläche = dein Normalbereich laut Garmin. " : ""}Entscheidend ist der Trend im Vergleich zum eigenen Normalbereich, nicht der Absolutwert. ${cite("plews")}`;

  const last = daily.filter((d) => d.date <= a.todayKey).slice(-7).reverse();
  const base = daily.filter((d) => d.date < addDays(a.todayKey, -1)).slice(-28);
  const avg = (k) => {
    const xs = base.map((d) => d[k]).filter((x) => x != null);
    return xs.length ? xs.reduce((m, x) => m + x, 0) / xs.length : NaN;
  };
  const dev = (v, k, d = 0, inv = false) => {
    const diff = v - avg(k);
    if (!Number.isFinite(diff) || Math.abs(diff) < (d ? 0.5 : 2)) return "";
    const bad = inv ? diff < 0 : diff > 0;
    return `<span class="sub ${bad ? "delta-down" : "delta-up"}">${signed(diff, d)}</span>`;
  };
  $("#vitals-table").innerHTML = `<thead><tr><th>Nacht</th><th class="num">Ruhepuls</th><th class="num">Atemfrequenz</th><th class="num">Body Battery</th><th class="num">Stress</th></tr></thead><tbody>
    ${last.map((d) => `<tr>
      <td>${d.date === a.todayKey ? "Heute" : fmtDay(d.date)}</td>
      <td class="num">${d.restingHr ? `${d.restingHr} bpm${dev(d.restingHr, "restingHr")}` : "–"}</td>
      <td class="num">${d.respiration ? `${num(d.respiration, 1)} /min${dev(d.respiration, "respiration", 1)}` : "–"}</td>
      <td class="num">${d.bodyBattery != null ? `${d.bodyBatteryLow ?? "–"} → ${d.bodyBattery}${dev(d.bodyBattery, "bodyBattery", 0, true)}` : "–"}</td>
      <td class="num">${d.stress ?? "–"}</td></tr>`).join("")}</tbody>`;
}

// ---------- Muster ----------

function renderPatterns(data, a) {
  const ill = I.illnessScore(data.daily || [], a.todayKey);
  if (ill) {
    const [cls, text] = { high: ["critical", "Erhöht – Warnmuster"], elevated: ["warn", "Leicht erhöht"], normal: ["good", "Unauffällig"] }[ill.level];
    const color = { critical: "var(--critical)", warn: "var(--warn)", good: "var(--good)" }[cls];
    $("#illness").innerHTML = `<div class="big-score"><div class="ring" style="--v:${ill.score};--ring-color:${color}"><span>${ill.score}</span></div>
      <div><div class="status"><span class="dot ${cls}"></span>${text}</div><div class="kpi-note">${ill.reasons.length ? esc(ill.reasons.join(" · ")) : "Alle Nachtwerte im persönlichen Normalbereich"}</div></div></div>`;
    lineChart($("#illness-chart"), ill.series.map((x) => ({ date: x.date, value: Math.round(x.points) })), { label: "Punkte", color: "var(--series-2)", height: 140 });
  } else {
    $("#illness").innerHTML = '<p class="hint">Für den Illness-Score werden mindestens 7 Nächte mit Ruhepuls, HRV oder Atemfrequenz benötigt.</p>';
    $("#illness-chart").innerHTML = "";
  }
  $("#illness-note").innerHTML = `Punkte aus Abweichungen vom eigenen Normalbereich: Ruhepuls ↑ ${cites(["radin", "mishra"])}, Atemfrequenz ↑ ${cite("miller")}, HRV ↓ ${cite("plews")}, Schlafscore ↓. Frühwarnhinweis, keine Diagnose.`;

  $("#readiness-table").innerHTML = `<thead><tr><th>Tag</th><th class="num">HRV</th><th class="num">Schlaf</th><th class="num">Trainingsstress</th><th class="num">Readiness</th></tr></thead><tbody>
    ${a.readinessWeek.map((r) => `<tr><td>${r.date === a.todayKey ? "Heute" : fmtDay(r.date)}</td>
      <td class="num">${num(r.parts?.hrv)}</td><td class="num">${num(r.parts?.sleep)}</td><td class="num">${num(r.parts?.load)}</td>
      <td class="num">${r.score != null ? `${scoreDot(r.score)} <b>${r.score}</b>` : "–"}</td></tr>`).join("")}
    ${a.weeklyReadiness ? `<tr><td><b>Woche</b></td><td colspan="3"></td><td class="num">${scoreDot(a.weeklyReadiness.score)} <b>${a.weeklyReadiness.score}</b></td></tr>` : ""}</tbody>`;
  $("#readiness-note").innerHTML = `Teilwerte 0–100. HRV im Vergleich zum 28-Tage-Normalbereich ${cite("plews")}, Schlafscore der Uhr, Trainingsstress aus der Form (TSB) ${cite("banister")}. Unter 50: Erholung priorisieren.`;

  const pat = I.patterns(data, a);
  const rows = [];
  if (pat.sleepPerformance) {
    const { good, poor, cut } = pat.sleepPerformance;
    rows.push(`<tr><td>Schlafscore ≥ ${cut} vor dem Lauf</td><td class="num">${signed(good.rel * 100)} %</td><td class="num">${num(good.te, 1)}</td><td class="num">${good.n}</td></tr>`);
    rows.push(`<tr><td>Schlafscore &lt; ${cut} vor dem Lauf</td><td class="num">${signed(poor.rel * 100)} %</td><td class="num">${num(poor.te, 1)}</td><td class="num">${poor.n}</td></tr>`);
  }
  $("#pattern-table").innerHTML = `<thead><tr><th>Zusammenhang</th><th class="num">Effizienz ggü. Ø</th><th class="num">Ø aerober TE</th><th class="num">n</th></tr></thead><tbody>
    ${rows.join("") || '<tr><td colspan="4" class="hint">Zu wenige Läufe mit Schlafdaten für einen Vergleich.</td></tr>'}
    ${pat.loadHrv ? `<tr><td>HRV nach Tagen mit hoher Belastung<span class="sub">oberstes Viertel, TRIMP ≥ ${Math.round(pat.loadHrv.q3)}</span></td><td class="num" colspan="2">${signed(pat.loadHrv.high.rel * 100)} % ggü. Ø</td><td class="num">${pat.loadHrv.high.n}</td></tr>` : ""}
    ${pat.sleepHrv ? `<tr><td>Korrelation Schlafscore ↔ HRV derselben Nacht</td><td class="num" colspan="2">r = ${num(pat.sleepHrv.r, 2)}</td><td class="num">${pat.sleepHrv.n}</td></tr>` : ""}</tbody>`;
  $("#pattern-note").innerHTML = `Effizienz = Tempo je Herzschlag, verglichen mit Läufen gleicher Intensität. |r| &lt; 0,3 gilt als schwacher Zusammenhang. Schlafmangel kann Ausdauerleistung und Erholung beeinträchtigen ${cite("fullagar")}. Zusammenhänge sind Beobachtungen, keine Kausalbeweise.`;
}

// ---------- Workouts ----------

const STEP_LABEL = { warmup: "Aufwärmen", interval: "Belastung", recovery: "Erholung", cooldown: "Auslaufen" };
const STEP_COLOR = { warmup: "var(--int-low)", interval: "var(--series-1)", recovery: "var(--int-low)", cooldown: "var(--int-low)" };

function currentWorkout() {
  const day = state.days?.[Number($("#workout-day").value) || 0];
  return day ? buildWorkout(day, state.analysis.profile) : null;
}

function renderWorkouts() {
  const sel = $("#workout-day");
  const prev = sel.value;
  sel.innerHTML = state.days.map((d, i) => `<option value="${i}">${i === 0 ? "Heute" : fmtDay(d.date)} · ${esc(d.intensity === "rest" ? "Ruhetag" : d.title)}</option>`).join("");
  if (prev) sel.value = prev;
  renderWorkoutPreview();
}

function renderWorkoutPreview() {
  const w = currentWorkout();
  const stepHtml = (s) => {
    if (s.kind === "repeat") return `<div class="wrepeat"><b>${s.n} × wiederholen</b>${s.steps.map(stepHtml).join("")}</div>`;
    return `<div class="wstep"><i style="background:${STEP_COLOR[s.kind]}"></i><div><b>${STEP_LABEL[s.kind]}</b> · ${fmtDuration(s.sec)}<small>${esc(s.note || "")}</small></div><span>${s.hr ? `${s.hr[0]}–${s.hr[1]} bpm` : "frei"}</span></div>`;
  };
  $("#workout-send").disabled = !w;
  $("#workout-fit").disabled = !w;
  $("#workout-preview").innerHTML = w
    ? `<p class="day-meta">${esc(w.name)} · ${SPORTS[w.sport]} · ${fmtDuration(totalSeconds(w.steps))} · ${INTENSITIES[w.intensity]}</p><div class="steps">${w.steps.map(stepHtml).join("")}</div>`
    : '<p class="hint">Für diesen Tag gibt es kein strukturiertes Ausdauer-Workout (Ruhetag, Wettkampf, Kraft oder Sportart ohne Workout-Unterstützung). Unterstützt werden Laufen und Radfahren.</p>';
  $("#workout-note").innerHTML = `„An Garmin Connect senden“ legt das Workout in deinem Garmin-Konto an und plant es für den gewählten Tag ein; die Uhr übernimmt es bei der nächsten Synchronisation (lokaler Server nötig). Alternativ die FIT-Datei per USB in den Ordner GARMIN/NewFiles der Uhr kopieren ${cite("fitWorkout")}. Intervallbereiche: ${cite("helgerud")}`;
}

// ---------- Statistik: Tag / Woche / Monat ----------

const MODE_TITLE = { day: "Tagesüberblick", week: "Wöchentlicher Überblick", month: "Monatsüberblick" };
const SPORT_COLOR = { run: "var(--c-cyan)", strength: "var(--c-pink)", bike: "var(--c-orange)", swim: "var(--c-violet)", mobility: "var(--c-lime)", walk: "var(--c-lime)", other: "var(--muted)" };
const ICONS = {
  steps: '<path d="M8 3c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5ZM5 16h6l-1 4H6l-1-4ZM16 6c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5ZM13 19h6l-1 2h-4l-1-2Z"/>',
  fire: '<path d="M12 22c4 0 7-3 7-7 0-5-4-7-5-11-2 2-3 4-3 6-1-1-2-2-2-4-2 2-4 5-4 9 0 4 3 7 7 7Z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
};

function periodLabel(mode, from, to) {
  const f = (k, o) => new Date(`${k}T12:00:00`).toLocaleDateString("de-DE", o);
  if (mode === "day") return f(from, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  if (mode === "week") return `${f(from, { day: "numeric", month: "short" })} – ${f(to, { day: "numeric", month: "short", year: "numeric" })}`;
  return f(from, { month: "long", year: "numeric" });
}

function deltaHtml(now, before, prevName, invert = false) {
  const c = P.change(now, before);
  if (c == null) return `<span class="kpi-delta flat">kein Vergleich</span>`;
  const good = invert ? c < 0 : c > 0;
  const cls = Math.abs(c) < 0.005 ? "flat" : good ? "up" : "down";
  return `<span class="kpi-delta ${cls}">${c >= 0 ? "+" : "−"}${num(Math.abs(c) * 100)} % vs. ${prevName}</span>`;
}

function statKpi({ label, value, unit = "", icon, color, delta }) {
  return `<div class="card hud kpi" style="--kpi-color:${color};--hud-accent:${color}">
    <div class="kpi-top"><span class="kpi-icon"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg></span>
    <div><div class="kpi-label">${label}</div><div class="kpi-value" style="color:${color};text-shadow:0 0 14px ${color}">${value}${unit ? `<small>${unit}</small>` : ""}</div></div></div>
    ${delta}
  </div>`;
}

function renderStats(data, a) {
  const { mode } = state.period;
  if (!state.period.anchor || state.period.anchor > a.todayKey) state.period.anchor = a.todayKey;
  const s = P.summarize(data, a, mode, state.period.anchor);
  const prev = P.summarize(data, a, mode, P.shiftAnchor(mode, state.period.anchor, -1));
  const prevName = { day: "Vortag", week: "Vorwoche", month: "Vormonat" }[mode];
  // Bei laufenden Zeiträumen werden Tagesdurchschnitte verglichen, damit die Werte fair bleiben
  const nDays = (x) => x.days.filter((d) => !d.future).length || 1;
  const perDay = (x, k) => (x[k] == null ? null : x[k] / nDays(x));

  $("#period-label").textContent = periodLabel(mode, s.from, s.to);
  $("#period-next").disabled = s.to >= a.todayKey;
  document.querySelectorAll(".segmented button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode));
  if (state.tab === "stats") {
    $("#headline").textContent = "Fitness Analytics";
    $("#subline").textContent = MODE_TITLE[mode];
  }

  const hours = (min) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
  $("#stats-kpis").innerHTML = [
    statKpi({ label: "Schritte", value: s.steps != null ? Math.round(s.steps).toLocaleString("de-DE") : "–", icon: "steps", color: "var(--c-cyan)", delta: deltaHtml(perDay(s, "steps"), perDay(prev, "steps"), prevName) }),
    statKpi({ label: "Kalorien", value: s.calories != null ? Math.round(s.calories).toLocaleString("de-DE") : "–", unit: "kcal", icon: "fire", color: "var(--c-pink)", delta: deltaHtml(perDay(s, "calories"), perDay(prev, "calories"), prevName) }),
    statKpi({ label: "Trainingszeit", value: hours(s.trainingMin), icon: "timer", color: "var(--c-orange)", delta: deltaHtml(perDay(s, "trainingMin") || null, perDay(prev, "trainingMin") || null, prevName) }),
    statKpi({ label: "Erholung", value: s.readiness ?? "–", unit: s.readiness != null ? "%" : "", icon: "heart", color: "var(--c-lime)", delta: deltaHtml(s.readiness, prev.readiness, prevName) }),
  ].join("");

  // Schritte-Ring
  $("#ring-title").textContent = mode === "day" ? "Schritte heute" : "Schritte";
  $("#ring-sub").textContent = mode === "day" ? "Tagesziel" : `Ziel: ${nDays(s)} × Tagesziel`;
  if (s.steps != null) {
    const ring = $("#steps-ring");
    ring.innerHTML = '<div class="ring-svg"></div><div class="mini-stats"></div>';
    SC.heroRing(ring.querySelector(".ring-svg"), s.steps, s.stepGoal, { label: "Schritte" });
    ring.querySelector(".mini-stats").innerHTML = `
      <div><b style="color:var(--c-lime)">${s.distanceKm != null ? num(s.distanceKm, 1) : "–"}</b><span>km</span></div>
      <div><b style="color:var(--c-pink)">${s.activeCalories != null ? Math.round(s.activeCalories).toLocaleString("de-DE") : "–"}</b><span>aktive kcal</span></div>
      <div><b style="color:var(--c-violet)">${s.sessions}</b><span>Einheiten</span></div>`;
  } else {
    $("#steps-ring").innerHTML = '<p class="hint">Keine Schrittdaten für diesen Zeitraum (nach Synchronisation mit Garmin Connect verfügbar).</p>';
  }

  // Trend und Tagesbalken; in der Tagesansicht zeigt der Trend die Woche um den Tag
  const context = mode === "day" ? P.summarize(data, a, "week", state.period.anchor).days : s.days;
  const metric = $("#trend-metric").value;
  const unitOf = { steps: "", calories: " kcal", trainingMin: " min", sleepHours: " h", hrv: " ms", readiness: "" };
  $("#trend-title").textContent = mode === "day" ? "Aktivitätstrend · Woche" : "Aktivitätstrend";
  SC.areaTrend($("#trend-chart"), context, metric, { unit: unitOf[metric], decimals: metric === "sleepHours" ? 1 : 0 });
  const barMetric = $("#bar-metric").value;
  SC.dayBars($("#bar-chart"), context, barMetric, {
    gradient: barMetric === "calories" ? "url(#grad-pink)" : barMetric === "trainingMin" ? "url(#grad-orange)" : "url(#grad-cyan)",
    highlight: mode === "day" ? state.period.anchor : a.todayKey,
    unit: unitOf[barMetric],
  });

  // Trainingsverteilung
  const totalMix = s.sportMix.reduce((t, x) => t + x.minutes, 0);
  $("#mix-sub").textContent = totalMix ? `${hours(totalMix)} gesamt` : "";
  $("#mix-chart").innerHTML = totalMix
    ? `<div class="donut-wrap"><div class="donut"></div><div class="mix-list">${s.sportMix.map((x) => `<div><span class="dot" style="background:${SPORT_COLOR[x.sport]};color:${SPORT_COLOR[x.sport]}"></span>${esc(x.label)}<strong>${hours(x.minutes)}</strong></div>`).join("")}</div></div>`
    : '<p class="hint">Keine Trainingseinheiten in diesem Zeitraum.</p>';
  if (totalMix) {
    SC.donut($("#mix-chart .donut"), s.sportMix.map((x) => ({ value: x.minutes, color: SPORT_COLOR[x.sport], label: x.label })), { center: hours(totalMix), centerSub: "Gesamt" });
  }

  // Erholungsstatus
  const score = mode === "day" ? s.days[0]?.readiness : s.readiness;
  const label = score == null ? "keine Daten" : score >= 70 ? "Sehr gut" : score >= 50 ? "Mittel" : "Erholung nötig";
  const color = score == null ? "var(--muted)" : score >= 70 ? "var(--c-cyan)" : score >= 50 ? "var(--warn)" : "var(--c-pink)";
  $("#recovery-gauge").innerHTML = `<div class="gauge"><div class="gauge-svg"></div>
    <div class="hint">${score == null ? "" : score >= 70 ? "Dein Körper ist bereit für neue Herausforderungen." : score >= 50 ? "Normal belastbar – intensive Reize gezielt setzen." : "Belastung reduzieren und Schlaf priorisieren."}</div>
    <div class="gauge-rows">
      <div><span>HRV</span><strong>${s.hrv != null ? `${Math.round(s.hrv)} ms` : "–"}</strong></div>
      <div><span>Ruhepuls</span><strong>${s.restingHr != null ? `${Math.round(s.restingHr)} bpm` : "–"}</strong></div>
      <div><span>Schlaf</span><strong>${s.sleepHours != null ? hours(s.sleepHours * 60) : "–"}</strong></div>
    </div></div>`;
  SC.gauge($("#recovery-gauge .gauge"), score, label, color);

  // Schlafphasen
  const st = s.stages;
  const night = mode === "day" ? s.dayDetail?.sleepLevels : null;
  $("#sleep-sub").textContent = mode === "day" ? "Nacht vor dem Tag" : "Ø pro Nacht";
  if (st) {
    const totalSleep = st.deep + st.light + st.rem;
    $("#stats-sleep").innerHTML = `<div class="sleep-summary"><div><div class="sleep-total">${hours(totalSleep)}</div><span class="card-sub">Schlafdauer</span></div>
      <div class="sleep-list">${[["awake", "Wach"], ["rem", "REM"], ["light", "Leicht"], ["deep", "Tief"]].map(([k, l]) => `<div><span class="dot" style="background:var(--stage-${k});color:var(--stage-${k})"></span>${l}<strong>${hours(st[k])}</strong></div>`).join("")}</div></div>
      <div class="chart" id="stats-sleep-chart"></div>`;
    if (night) SC.hypnogram($("#stats-sleep-chart"), night);
    else {
      const rows = s.days.filter((d) => !d.future).map((d) => ({ date: d.date, values: (data.daily || []).find((x) => x.date === d.date)?.sleepStages || {} }));
      stackedBars($("#stats-sleep-chart"), rows, STAGES, { height: 170 });
    }
  } else {
    $("#stats-sleep").innerHTML = '<p class="hint">Keine Schlafphasen für diesen Zeitraum.</p>';
  }

  // Herzfrequenz: Tagesverlauf in der Tagesansicht, sonst Ruhepuls je Tag
  const hrDay = mode === "day" ? s.dayDetail?.hrDay : null;
  if (hrDay && hrDay.some((v) => v != null)) {
    const vals = hrDay.filter((v) => v != null);
    const last = vals.at(-1);
    $("#hr-sub").textContent = "Tagesverlauf";
    $("#stats-hr").innerHTML = `<div class="hr-head"><div class="hr-now"><span class="heart">♥</span>${last}<small>bpm</small></div>
      <div class="hr-meta">Ø ${Math.round(vals.reduce((t, v) => t + v, 0) / vals.length)} bpm · Max ${Math.max(...vals)} bpm · Ruhepuls ${s.restingHr ?? "–"} bpm</div></div><div class="chart" id="hr-day-chart"></div>`;
    SC.hrDayChart($("#hr-day-chart"), hrDay);
  } else {
    const series = s.days.filter((d) => d.restingHr != null).map((d) => ({ date: d.date, value: d.restingHr }));
    $("#hr-sub").textContent = mode === "day" ? "kein Tagesverlauf vorhanden" : "Ruhepuls je Tag";
    $("#stats-hr").innerHTML = `<div class="hr-head"><div class="hr-now"><span class="heart">♥</span>${s.restingHr != null ? Math.round(s.restingHr) : "–"}<small>bpm Ø Ruhepuls</small></div></div><div class="chart" id="hr-rest-chart"></div>`;
    lineChart($("#hr-rest-chart"), series, { label: "Ruhepuls", unit: " bpm", color: "var(--c-pink)", height: 170 });
  }
}

// ---------- Seitenleiste ----------

function renderSidebar(data, a) {
  const name = data.source === "demo" ? "Demo-Athlet" : data.profile?.name || "Athlet";
  $("#avatar").textContent = name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase();
  $("#profile-name").textContent = name;
  const vo2 = I.vo2maxTrend(data, a.todayKey);
  $("#profile-level").innerHTML = `Fitness ${Math.round(a.ctl)}${vo2 ? ` · <b>VO2max ${num(vo2.latest, 1)}</b>` : ""}`;
  const r = a.readiness;
  const [cls, txt] = { good: ["good", "Bereit"], normal: ["warn", "Normal belastbar"], low: ["critical", "Erholung empfohlen"] }[r.status] || ["", "keine Daten"];
  $("#profile-status").innerHTML = `<span class="dot ${cls}"></span>${txt}`;
  $(".connection").classList.toggle("demo", data.source !== "garmin");
}

// ---------- Garmin Connect ----------

$("#btn-sync").addEventListener("click", async () => {
  if (!state.server) {
    toast("Für Garmin Connect bitte den lokalen Server starten: python server.py", 6000);
    return;
  }
  const btn = $("#btn-sync");
  btn.disabled = true;
  toast("Synchronisiere mit Garmin Connect …", 60000);
  try {
    const { ok, body } = await fetchJson("api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: 120 }) });
    if (!ok) throw new Error(body.error);
    state.data = body;
    render();
    toast(`${body.activities.length} Aktivitäten synchronisiert.`);
  } catch (e) {
    toast(e.message, 8000);
  } finally {
    btn.disabled = false;
  }
});

// ---------- FIT-Import ----------

function saveImported(acts) {
  const ids = new Set(state.imported.map((x) => x.id));
  state.imported.push(...acts.filter((x) => !ids.has(x.id)));
  store.set("imported", state.imported);
}

$("#fit-input").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  const acts = [];
  for (const f of files) {
    try {
      acts.push(await parseFitFile(f, state.analysis.profile));
    } catch (err) {
      toast(err.message, 6000);
    }
  }
  if (acts.length) {
    saveImported(acts);
    render();
    toast(`${acts.length} FIT-Datei${acts.length > 1 ? "en" : ""} importiert.`);
  }
});

// ---------- Bluetooth ----------

function zoneLabel(hr) {
  const p = state.analysis.profile;
  const pct = hr / p.hrMax;
  const [cls, name] = pct < p.lt1Pct ? ["good", "Locker"] : pct < p.lt2Pct ? ["warn", "Moderat"] : ["critical", "Intensiv"];
  return `<span class="dot ${cls}"></span>${name} · ${Math.round(pct * 100)} % HFmax`;
}

$("#btn-ble").addEventListener("click", async () => {
  if (state.ble) return;
  try {
    state.ble = await connectHeartRate({
      onValue(hr) {
        state.live.push(hr);
        if (state.live.length > 180) state.live.shift();
        state.recording?.samples.push({ t: Date.now(), hr });
        $("#live-bpm").textContent = hr;
        $("#live-zone").innerHTML = zoneLabel(hr);
        sparkline($("#live-chart"), state.live);
      },
      onDisconnect() {
        stopRecording();
        state.ble = null;
        state.live = [];
        $("#live").classList.remove("on");
        toast("Bluetooth-Verbindung getrennt.");
      },
    });
    $("#live-device").textContent = state.ble.name;
    $("#live").classList.add("on");
    toast("Verbunden – Live-Puls wird empfangen.");
  } catch (e) {
    if (e.name !== "NotFoundError") toast(e.message, 7000);
    else toast("Keine Uhr gewählt. Auf der Garmin-Uhr „Herzfrequenz übertragen“ aktivieren.", 7000);
  }
});

function stopRecording() {
  const rec = state.recording;
  state.recording = null;
  $("#live-rec").textContent = "Aufzeichnen";
  if (!rec || rec.samples.length < 30) return;
  const p = state.analysis.profile;
  const s = rec.samples;
  const intensitySec = [0, 0, 0];
  for (let i = 1; i < s.length; i++) {
    const dt = (s[i].t - s[i - 1].t) / 1000;
    if (dt > 10) continue;
    const pct = s[i].hr / p.hrMax;
    intensitySec[pct < p.lt1Pct ? 0 : pct < p.lt2Pct ? 1 : 2] += dt;
  }
  const start = new Date(s[0].t);
  const pad = (n) => String(n).padStart(2, "0");
  const sport = $("#live-sport").value;
  saveImported([{
    id: `ble-${s[0].t}`,
    start: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}:00`,
    sport,
    name: `${SPORTS[sport]} (Live-Aufzeichnung)`,
    durationSec: Math.round((s[s.length - 1].t - s[0].t) / 1000),
    avgHr: Math.round(s.reduce((sum, x) => sum + x.hr, 0) / s.length),
    maxHr: Math.max(...s.map((x) => x.hr)),
    intensitySec: intensitySec.map(Math.round),
    source: "ble",
  }]);
  render();
  toast("Aufzeichnung gespeichert und in die Analyse übernommen.");
}

$("#live-rec").addEventListener("click", () => {
  if (state.recording) return stopRecording();
  state.recording = { samples: [] };
  $("#live-rec").textContent = "Stopp & speichern";
});
$("#live-stop").addEventListener("click", () => state.ble?.disconnect());

// ---------- Reiter ----------

function showTab(name) {
  state.tab = name;
  document.querySelectorAll(".nav button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== name));
  store.set("tab", name);
  window.scrollTo({ top: 0 });
  // Diagramme in vorher verborgenen Reitern brauchen die echte Breite
  if (state.analysis) render();
}
$(".nav").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) showTab(b.dataset.tab);
});

// ---------- Workouts senden ----------

$("#workout-day").addEventListener("change", renderWorkoutPreview);

// ---------- Zeitraum der Statistik ----------

$(".segmented").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b) return;
  state.period.mode = b.dataset.mode;
  store.set("periodMode", b.dataset.mode);
  renderStats(state.merged, state.analysis);
});
$("#period-prev").addEventListener("click", () => {
  state.period.anchor = P.shiftAnchor(state.period.mode, state.period.anchor, -1);
  renderStats(state.merged, state.analysis);
});
$("#period-next").addEventListener("click", () => {
  const next = P.shiftAnchor(state.period.mode, state.period.anchor, 1);
  state.period.anchor = next > state.analysis.todayKey ? state.analysis.todayKey : next;
  renderStats(state.merged, state.analysis);
});
$("#trend-metric").addEventListener("change", () => renderStats(state.merged, state.analysis));
$("#bar-metric").addEventListener("change", () => renderStats(state.merged, state.analysis));

$("#workout-send").addEventListener("click", async () => {
  const w = currentWorkout();
  if (!w) return;
  if (!state.server) {
    toast("Zum Senden an Garmin Connect bitte den lokalen Server starten: python server.py", 6000);
    return;
  }
  const btn = $("#workout-send");
  btn.disabled = true;
  try {
    const { ok, body } = await fetchJson("api/workout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout: toGarminWorkout(w), date: w.date }) });
    if (!ok) throw new Error(body.error);
    toast(`Workout „${w.name}“ für ${fmtDay(w.date)} in Garmin Connect eingeplant. Uhr synchronisieren, um es zu übertragen.`, 7000);
  } catch (e) {
    toast(e.message, 8000);
  } finally {
    btn.disabled = false;
  }
});

$("#workout-fit").addEventListener("click", async () => {
  const w = currentWorkout();
  if (!w) return;
  try {
    const bytes = encodeFitWorkout(w, await loadFitSdk());
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `${w.date}-${w.name.replace(/[^\wäöüÄÖÜß-]+/g, "_")}.fit` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("FIT-Datei erstellt – per USB nach GARMIN/NewFiles kopieren.", 6000);
  } catch (e) {
    toast(`FIT-Datei konnte nicht erstellt werden: ${e.message}`, 7000);
  }
});

// ---------- Vorschläge ----------

$("#days").addEventListener("click", (e) => {
  const btn = e.target.closest(".day");
  if (!btn) return;
  state.selectedDay = Number(btn.dataset.i);
  document.querySelectorAll(".day").forEach((b) => b.setAttribute("aria-expanded", b === btn));
  renderDayDetail();
});

// ---------- Trainingsplan ----------

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const options = (map, sel) => Object.entries(map).map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${v}</option>`).join("");

$("#btn-plan").addEventListener("click", () => {
  const form = $("#plan-dialog form");
  form.goal.value = state.plan.goal || "";
  form.raceDate.value = state.plan.raceDate || "";
  form.raceDate.min = addDays(state.analysis.todayKey, 0);
  $("#plan-rows").innerHTML = state.plan.week.map((s, i) => `
    <div class="plan-row" data-i="${i}">
      <b>${WEEKDAYS[i]}</b>
      <select name="sport" aria-label="Sportart ${WEEKDAYS[i]}">${options(SPORTS, s.sport)}</select>
      <select name="intensity" aria-label="Intensität ${WEEKDAYS[i]}">${options(Object.fromEntries(Object.entries(INTENSITIES).filter(([k]) => k !== "race")), s.intensity)}</select>
      <input name="durationMin" type="number" min="0" max="600" step="5" value="${s.durationMin}" aria-label="Dauer in Minuten ${WEEKDAYS[i]}">
      <input name="title" type="text" value="${esc(s.title)}" placeholder="Bezeichnung" aria-label="Bezeichnung ${WEEKDAYS[i]}">
    </div>`).join("");
  $("#plan-dialog").showModal();
});

$("#plan-dialog").addEventListener("close", async () => {
  if ($("#plan-dialog").returnValue !== "save") return;
  const form = $("#plan-dialog form");
  const week = [...document.querySelectorAll(".plan-row")].map((row) => {
    const sport = row.querySelector('[name="sport"]').value;
    const intensity = sport === "rest" ? "rest" : row.querySelector('[name="intensity"]').value;
    return {
      sport: intensity === "rest" ? "rest" : sport,
      intensity,
      durationMin: intensity === "rest" ? 0 : Number(row.querySelector('[name="durationMin"]').value) || 0,
      title: row.querySelector('[name="title"]').value.trim(),
    };
  });
  state.plan = { goal: form.goal.value.trim(), raceDate: form.raceDate.value, week };
  store.set("plan", state.plan);
  if (state.server) {
    try {
      await fetchJson("api/plan", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state.plan) });
    } catch { /* lokal gespeichert */ }
  }
  render();
  toast("Trainingsplan gespeichert.");
});

// ---------- Profil ----------

$("#btn-profile").addEventListener("click", () => {
  const form = $("#profile-dialog form");
  const p = state.analysis.profile;
  const o = state.profileOverrides;
  form.age.value = p.age ?? "";
  form.sex.value = p.sex;
  form.hrMax.value = o.hrMax ?? "";
  form.hrMax.placeholder = `${p.hrMax} (${p.hrMaxSource})`;
  form.hrRest.value = o.hrRest ?? "";
  form.hrRest.placeholder = `${p.hrRest} (aus Garmin-Daten)`;
  form.lt1Pct.value = Math.round(p.lt1Pct * 100);
  form.lt2Pct.value = Math.round(p.lt2Pct * 100);
  $("#profile-hint").innerHTML = `Ohne Angabe wird der höchste gemessene Puls oder die Formel 208 − 0,7 × Alter verwendet (${cite("tanaka")}). Die Schwellen sind Näherungswerte; genauer sind sie aus einer Leistungsdiagnostik (Laktat- oder Spiroergometrie). ${cite("seiler")}`;
  $("#profile-dialog").showModal();
});

$("#profile-dialog").addEventListener("close", () => {
  const rv = $("#profile-dialog").returnValue;
  if (rv === "reset") state.profileOverrides = {};
  else if (rv === "save") {
    const f = $("#profile-dialog form");
    const n = (v) => (v === "" ? undefined : Number(v));
    state.profileOverrides = JSON.parse(JSON.stringify({
      age: n(f.age.value),
      sex: f.sex.value,
      hrMax: n(f.hrMax.value),
      hrRest: n(f.hrRest.value),
      lt1Pct: n(f.lt1Pct.value) / 100 || undefined,
      lt2Pct: n(f.lt2Pct.value) / 100 || undefined,
    }));
  } else return;
  store.set("profile", state.profileOverrides);
  render();
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.analysis) return;
    pmcChart($("#pmc-chart"), state.analysis.model);
    weekChart($("#week-chart"), state.analysis.weeks);
  }, 150);
});

if (!document.querySelector(`.nav button[data-tab="${state.tab}"]`)) state.tab = "overview";
document.querySelectorAll(".nav button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== state.tab));
load();
