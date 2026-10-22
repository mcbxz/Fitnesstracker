// Zusammenfassung von Tages-, Wochen- und Monatszeiträumen für den Reiter "Statistik".
import { addDays, weekdayIndex, readinessFor, SPORTS } from "./analysis.js";

const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : NaN);

export function periodRange(mode, anchor) {
  if (mode === "day") return { from: anchor, to: anchor };
  if (mode === "week") {
    const from = addDays(anchor, -weekdayIndex(anchor));
    return { from, to: addDays(from, 6) };
  }
  const [y, m] = anchor.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

export function shiftAnchor(mode, anchor, dir) {
  if (mode === "day") return addDays(anchor, dir);
  if (mode === "week") return addDays(anchor, 7 * dir);
  const [y, m] = anchor.split("-").map(Number);
  const d = new Date(y, m - 1 + dir, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function daysOf(from, to) {
  const out = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

// Kennzahlen eines Zeitraums; Tage nach "heute" werden nicht mitgezählt.
export function summarize(data, a, mode, anchor) {
  const { from, to } = periodRange(mode, anchor);
  const end = to > a.todayKey ? a.todayKey : to;
  const keys = from <= end ? daysOf(from, end) : [];
  const daily = new Map((data.daily || []).map((d) => [d.date, d]));
  const acts = data.activities.filter((x) => {
    const k = x.start.slice(0, 10);
    return k >= from && k <= end;
  });

  const days = daysOf(from, to).map((date) => {
    const d = daily.get(date) || {};
    const dayActs = acts.filter((x) => x.start.startsWith(date));
    const future = date > a.todayKey;
    return {
      date,
      future,
      steps: d.steps ?? null,
      calories: d.calories ?? null,
      activeCalories: d.activeCalories ?? null,
      distanceKm: d.distanceKm ?? null,
      trainingMin: future ? null : sum(dayActs.map((x) => (x.durationSec || 0) / 60)),
      sleepHours: d.sleepHours ?? null,
      hrv: d.hrv ?? null,
      restingHr: d.restingHr ?? null,
      readiness: future ? null : readinessFor(data.daily || [], a.fullModel, date).score,
    };
  });
  const past = days.filter((d) => !d.future);
  const vals = (k) => past.map((d) => d[k]).filter((v) => v != null);

  const mix = {};
  for (const x of acts) mix[x.sport] = (mix[x.sport] || 0) + (x.durationSec || 0) / 60;
  const sportMix = Object.entries(mix)
    .map(([sport, minutes]) => ({ sport, label: SPORTS[sport] || sport, minutes }))
    .sort((p, q) => q.minutes - p.minutes);

  const stageDays = keys.map((k) => daily.get(k)?.sleepStages).filter(Boolean);
  const stages = stageDays.length
    ? Object.fromEntries(["deep", "light", "rem", "awake"].map((s) => [s, mean(stageDays.map((x) => x[s] || 0))]))
    : null;

  const stepGoal = mean(keys.map((k) => daily.get(k)?.stepGoal).filter(Boolean)) || 10000;
  return {
    mode,
    from,
    to,
    days,
    steps: vals("steps").length ? sum(vals("steps")) : null,
    stepsAvg: vals("steps").length ? mean(vals("steps")) : null,
    stepGoal: stepGoal * (mode === "day" ? 1 : past.length || 1),
    calories: vals("calories").length ? sum(vals("calories")) : null,
    activeCalories: vals("activeCalories").length ? sum(vals("activeCalories")) : null,
    distanceKm: vals("distanceKm").length ? sum(vals("distanceKm")) : null,
    trainingMin: sum(vals("trainingMin")),
    sessions: acts.length,
    sleepHours: vals("sleepHours").length ? mean(vals("sleepHours")) : null,
    hrv: vals("hrv").length ? mean(vals("hrv")) : null,
    restingHr: vals("restingHr").length ? mean(vals("restingHr")) : null,
    readiness: vals("readiness").length ? Math.round(mean(vals("readiness"))) : null,
    sportMix,
    stages,
    activities: acts,
    dayDetail: mode === "day" ? daily.get(from) || null : null,
  };
}

export function change(now, before) {
  if (now == null || before == null || !before) return null;
  return now / before - 1;
}
