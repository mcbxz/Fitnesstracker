import {
  analyze, tips, suggestDays, trimp, intensitySplit, addDays,
  DEFAULT_PLAN, INTENSITIES, SPORTS,
} from "./analysis.js";
import { demoData } from "./demo.js";
import { pmcChart, weekChart, sparkline } from "./charts.js";
import { connectHeartRate } from "./bluetooth.js";
import { parseFitFile } from "./fit-import.js";
import { cite } from "./sources.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d).replace(".", ",") : "–");
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
  renderTips(a);
  renderActivities(data.activities, a.profile);
}

function renderHeader(data, a, today) {
  const h = new Date().getHours();
  const hello = h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
  const name = data.profile?.name && data.source !== "demo" ? `, ${data.profile.name.split(" ")[0]}` : "";
  $("#headline").textContent = `${hello}${name}`;
  const what = today.intensity === "rest" ? "Ruhetag" : `${today.title || SPORTS[today.sport]} · ${INTENSITIES[today.intensity]} · ${today.durationMin} min`;
  $("#subline").textContent = `Heute empfohlen: ${what}`;

  const badge = $("#source-badge");
  if (data.source === "garmin") {
    badge.textContent = `Garmin Connect · ${new Date(data.syncedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`;
  } else {
    badge.textContent = state.imported.length ? `Beispieldaten + ${state.imported.length} importiert` : "Beispieldaten";
  }
  $("#footer").innerHTML = `Die Empfehlungen sind trainingswissenschaftlich begründete Richtwerte und ersetzen keine ärztliche oder trainerische Beratung. Maximalpuls: ${a.profile.hrMax} bpm (${a.profile.hrMaxSource}${a.profile.hrMaxSource === "Tanaka-Formel" ? `, ${cite("tanaka")}` : ""}), Ruhepuls: ${a.profile.hrRest} bpm. Live-Puls: ${cite("bleHr")} · FIT-Import: ${cite("fit")}`;
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

function renderTips(a) {
  const list = tips(a);
  const level = { warn: "critical", info: "info", good: "good" };
  $("#tips").innerHTML = list.length
    ? list.map((t) => `<div class="tip"><span class="dot ${level[t.level]}"></span><div class="tip-title">${t.title}</div><div class="tip-text">${t.text} ${cite(t.source)}</div></div>`).join("")
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
    <thead><tr><th>Datum</th><th>Aktivität</th><th>Dauer</th><th>Distanz</th><th>Ø Puls</th><th>Belastung</th><th>Schwerpunkt</th></tr></thead>
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
        <td>${Math.round(trimp(act, p))}</td>
        <td>${act.avgHr || act.intensitySec ? main : "–"}</td>
      </tr>`;
    }).join("")}</tbody>`;
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

load();
