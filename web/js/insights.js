// Vertiefte Auswertungen: 7-Tage-Übersicht, VO2max-Trend, Trainingseffekte, Laufeffizienz,
// Schlafarchitektur, Illness-Score und Zusammenhänge zwischen Schlaf, Belastung und HRV.
import { addDays, intensitySplit } from "./analysis.js";

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const sd = (xs) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const dayOf = (a) => a.start.slice(0, 10);
const inRange = (k, from, to) => k >= from && k <= to;

export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 5) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}

// ---------- Letzte 7 Tage ----------

export function last7Days(data, a) {
  const rows = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(a.todayKey, -i);
    const d = (data.daily || []).find((x) => x.date === date) || {};
    const acts = data.activities.filter((x) => dayOf(x) === date);
    const st = d.sleepStages;
    const total = st ? st.deep + st.rem + st.light : 0;
    rows.push({
      date,
      sleepHours: d.sleepHours,
      sleepScore: d.sleepScore,
      deepPct: total ? st.deep / total : null,
      remPct: total ? st.rem / total : null,
      hrv: d.hrv,
      hrvStatus: d.hrvStatus,
      restingHr: d.restingHr,
      bodyBattery: d.bodyBattery,
      trimp: a.fullModel.find((m) => m.date === date)?.load || 0,
      garminLoad: acts.reduce((s, x) => s + (x.trainingLoad || 0), 0) || null,
      sessions: acts.map((x) => x.name),
      readiness: a.readinessWeek.find((r) => r.date === date)?.score ?? null,
    });
  }
  return rows;
}

// ---------- VO2max ----------

export function vo2maxTrend(data, todayKey) {
  let series = (data.vo2max || []).filter((x) => x.vo2max);
  if (!series.length) {
    series = data.activities.filter((x) => x.vo2max).map((x) => ({ date: dayOf(x), vo2max: x.vo2max }));
  }
  series = series.filter((x) => x.date >= addDays(todayKey, -119)).sort((x, y) => x.date.localeCompare(y.date));
  if (!series.length) return null;
  const latest = series[series.length - 1];
  const at = (days) => {
    const cut = addDays(todayKey, -days);
    const past = series.filter((x) => x.date <= cut);
    return past.length ? past[past.length - 1].vo2max : null;
  };
  const v28 = at(28);
  const v84 = at(84);
  return {
    series,
    latest: latest.vo2max,
    delta28: v28 != null ? latest.vo2max - v28 : null,
    delta84: v84 != null ? latest.vo2max - v84 : null,
  };
}

// ---------- Trainingslast & Trainingseffekt ----------

export function garminLoad(activities, todayKey) {
  const sum = (from) => activities.filter((x) => dayOf(x) >= from && dayOf(x) <= todayKey).reduce((s, x) => s + (x.trainingLoad || 0), 0);
  const acute = sum(addDays(todayKey, -6));
  const chronic = sum(addDays(todayKey, -27)) / 4;
  if (!chronic) return null;
  return { acute, chronic, ratio: acute / chronic };
}

export function trainingEffects(activities, todayKey) {
  const from = addDays(todayKey, -27);
  const acts = activities.filter((x) => dayOf(x) >= from && x.aerobicTE != null);
  if (!acts.length) return null;
  return {
    count: acts.length,
    aerobic: mean(acts.map((x) => x.aerobicTE)),
    anaerobic: mean(acts.map((x) => x.anaerobicTE || 0)),
    aerobicImproving: acts.filter((x) => x.aerobicTE >= 3).length,
    anaerobicImproving: acts.filter((x) => (x.anaerobicTE || 0) >= 2).length,
    overreaching: acts.filter((x) => x.aerobicTE >= 4.5 || (x.anaerobicTE || 0) >= 4.5).length,
  };
}

// Laufeffizienz lockerer Läufe: Geschwindigkeit (m/min) je Herzschlag, letzte 4 Wochen ggü. den 4 Wochen davor
export function runEfficiency(activities, p, todayKey) {
  const easyRuns = activities.filter((x) => x.sport === "run" && x.avgSpeed && x.avgHr && x.avgHr < p.lt1Pct * p.hrMax);
  const block = (from, to) => {
    const runs = easyRuns.filter((x) => inRange(dayOf(x), from, to));
    if (!runs.length) return null;
    return {
      n: runs.length,
      ef: mean(runs.map((x) => (x.avgSpeed * 60) / x.avgHr)),
      pace: mean(runs.map((x) => 1000 / x.avgSpeed)),
      hr: mean(runs.map((x) => x.avgHr)),
    };
  };
  const now = block(addDays(todayKey, -27), todayKey);
  const before = block(addDays(todayKey, -55), addDays(todayKey, -28));
  if (!now) return null;
  return { now, before, change: before ? now.ef / before.ef - 1 : null };
}

// ---------- Schlafarchitektur ----------

export function sleepArchitecture(daily, todayKey, nights = 14) {
  const withStages = daily.filter((d) => d.sleepStages && d.date <= todayKey);
  const pct = (d, k) => {
    const s = d.sleepStages;
    const total = s.deep + s.rem + s.light;
    return total ? s[k] / total : NaN;
  };
  const recent = withStages.slice(-nights);
  const base = withStages.filter((d) => d.date >= addDays(todayKey, -27));
  if (!recent.length) return null;
  return {
    nights: recent,
    avg: {
      deep: mean(base.map((d) => pct(d, "deep"))),
      rem: mean(base.map((d) => pct(d, "rem"))),
      hours: mean(base.map((d) => d.sleepHours).filter(Boolean)),
      awake: mean(base.map((d) => d.sleepStages.awake)),
    },
    last7: {
      deep: mean(recent.slice(-7).map((d) => pct(d, "deep"))),
      rem: mean(recent.slice(-7).map((d) => pct(d, "rem"))),
      hours: mean(recent.slice(-7).map((d) => d.sleepHours).filter(Boolean)),
    },
  };
}

// ---------- Illness-Score ----------

// Frühwarnwert 0–100 aus Abweichungen vom persönlichen Normalbereich: steigender Ruhepuls
// (Radin et al. 2020; Mishra et al. 2020), fallende HRV, steigende Atemfrequenz (Miller et al. 2020)
// und schlechterer Schlaf. Keine Diagnose.
function illnessPoints(night, base) {
  const reasons = [];
  let pts = 0;
  const rhr = base.map((d) => d.restingHr).filter(Boolean);
  if (night.restingHr && rhr.length >= 7) {
    const delta = night.restingHr - mean(rhr);
    pts += clamp((delta - 1) * 7, 0, 35);
    if (delta >= 3) reasons.push(`Ruhepuls +${Math.round(delta)} bpm`);
  }
  const hrv = base.map((d) => d.hrv).filter(Boolean);
  if (night.hrv && hrv.length >= 7) {
    const z = (night.hrv - mean(hrv)) / (sd(hrv) || 1);
    pts += clamp((-z - 0.5) * 12, 0, 30);
    if (z <= -1) reasons.push(`HRV −${Math.round((1 - night.hrv / mean(hrv)) * 100)} %`);
  }
  const resp = base.map((d) => d.respiration).filter(Boolean);
  if (night.respiration && resp.length >= 7) {
    const delta = night.respiration - mean(resp);
    pts += clamp((delta - 0.3) * 18, 0, 25);
    if (delta >= 0.8) reasons.push(`Atemfrequenz +${delta.toFixed(1).replace(".", ",")}/min`);
  }
  const sleep = base.map((d) => d.sleepScore).filter((x) => x != null);
  if (night.sleepScore != null && sleep.length >= 7) {
    const drop = mean(sleep) - night.sleepScore;
    pts += clamp(drop / 2, 0, 10);
    if (drop >= 10) reasons.push(`Schlafscore −${Math.round(drop)}`);
  }
  return { pts, reasons };
}

export function illnessScore(daily, todayKey) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const date = addDays(todayKey, -i);
    const night = byDate.get(date);
    if (!night) continue;
    // Basis ohne die beiden jüngsten Nächte, damit ein beginnender Infekt sie nicht verwässert
    const base = daily.filter((d) => d.date < addDays(date, -1) && d.date >= addDays(date, -30));
    const { pts, reasons } = illnessPoints(night, base);
    series.push({ date, points: pts, reasons });
  }
  if (!series.length) return null;
  const today = series[series.length - 1];
  const prev = series[series.length - 2];
  // Gewichtung über zwei Nächte: ein einzelner Ausreißer zählt weniger als ein anhaltendes Muster
  const score = Math.round(prev ? 0.6 * today.points + 0.4 * prev.points : today.points);
  const level = score >= 50 ? "high" : score >= 25 ? "elevated" : "normal";
  return { score: clamp(score, 0, 100), level, reasons: today.reasons, series };
}

// ---------- Mustererkennung ----------

export function patterns(data, a) {
  const p = a.profile;
  const daily = data.daily || [];
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const from = addDays(a.todayKey, -55);
  const out = {};

  // 1. Schlaf der Nacht vor einem Lauf und relative Laufeffizienz
  const runs = data.activities.filter((x) => x.sport === "run" && x.avgSpeed && x.avgHr && dayOf(x) >= from);
  const cls = (x) => {
    const s = intensitySplit(x, p);
    return s.indexOf(Math.max(...s));
  };
  const efBy = [0, 1, 2].map((c) => mean(runs.filter((x) => cls(x) === c).map((x) => (x.avgSpeed * 60) / x.avgHr)));
  const paired = runs
    .map((x) => ({ sleep: byDate.get(dayOf(x))?.sleepScore, rel: (x.avgSpeed * 60) / x.avgHr / efBy[cls(x)] - 1, te: x.aerobicTE }))
    .filter((x) => x.sleep != null && Number.isFinite(x.rel));
  if (paired.length >= 6) {
    const cut = [...paired.map((x) => x.sleep)].sort((m, n) => m - n)[Math.floor(paired.length / 2)];
    const good = paired.filter((x) => x.sleep >= cut);
    const poor = paired.filter((x) => x.sleep < cut);
    if (good.length && poor.length) {
      out.sleepPerformance = {
        cut,
        good: { n: good.length, rel: mean(good.map((x) => x.rel)), te: mean(good.map((x) => x.te).filter((v) => v != null)) },
        poor: { n: poor.length, rel: mean(poor.map((x) => x.rel)), te: mean(poor.map((x) => x.te).filter((v) => v != null)) },
        r: pearson(paired.map((x) => x.sleep), paired.map((x) => x.rel)),
      };
    }
  }

  // 2. Schlafscore und HRV derselben Nacht
  const nights = daily.filter((d) => d.date >= from && d.sleepScore != null && d.hrv);
  if (nights.length >= 10) out.sleepHrv = { n: nights.length, r: pearson(nights.map((d) => d.sleepScore), nights.map((d) => d.hrv)) };

  // 3. Hohe Tagesbelastung und HRV der folgenden Nacht
  const days = a.fullModel.filter((m) => m.date >= from && m.date < a.todayKey && byDate.get(addDays(m.date, 1))?.hrv);
  if (days.length >= 14) {
    const loads = days.map((m) => m.load).sort((x, y) => x - y);
    const q3 = loads[Math.floor(loads.length * 0.75)];
    const hrvMean = mean(days.map((m) => byDate.get(addDays(m.date, 1)).hrv));
    const rel = (set) => mean(set.map((m) => byDate.get(addDays(m.date, 1)).hrv)) / hrvMean - 1;
    const high = days.filter((m) => m.load >= q3 && m.load > 0);
    const rest = days.filter((m) => m.load < q3);
    if (high.length && rest.length) out.loadHrv = { q3, high: { n: high.length, rel: rel(high) }, rest: { n: rest.length, rel: rel(rest) } };
  }
  return out;
}

// ---------- Coach-Hinweise aus den vertieften Auswertungen ----------

const pctFmt = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1).replace(".", ",")} %`;

export function insightTips(data, a) {
  const out = [];
  const ill = illnessScore(data.daily || [], a.todayKey);
  if (ill && ill.level !== "normal") {
    out.push({
      level: ill.level === "high" ? "warn" : "info",
      title: ill.level === "high" ? "Mögliches Infektzeichen" : "Leicht auffällige Nachtwerte",
      text: `Illness-Score ${ill.score}/100: ${ill.reasons.join(", ")}. Ein Anstieg des Ruhepulses kann einer Erkältung oder Infektion vorausgehen; heute nur locker oder pausieren und Symptome beobachten. Keine Diagnose.`,
      source: ["radin", "mishra"],
    });
  }
  const v = vo2maxTrend(data, a.todayKey);
  if (v && v.delta28 != null) {
    if (v.delta28 >= 0.5) {
      out.push({ level: "good", title: "VO2max steigt", text: `VO2max (maximale Sauerstoffaufnahme) ${v.latest.toFixed(1).replace(".", ",")}, ${v.delta28 >= 0 ? "+" : ""}${v.delta28.toFixed(1).replace(".", ",")} in 4 Wochen. Der aktuelle Mix aus Grundlage und Intervallen wirkt.`, source: "helgerud" });
    } else if (v.delta28 <= -0.5) {
      out.push({ level: "info", title: "VO2max rückläufig", text: `VO2max (maximale Sauerstoffaufnahme) ${v.delta28.toFixed(1).replace(".", ",")} in 4 Wochen. Eine Intervalleinheit pro Woche (z. B. 4 × 4 min bei 90–95 % HFmax) einplanen, sofern die Erholung es zulässt.`, source: "helgerud" });
    }
  }
  const s = sleepArchitecture(data.daily || [], a.todayKey);
  if (s && (s.last7.hours < 7 || s.last7.deep < s.avg.deep * 0.85 || s.last7.rem < s.avg.rem * 0.85)) {
    out.push({
      level: "info",
      title: "Schlafqualität gesunken",
      text: `Letzte 7 Nächte: Ø ${s.last7.hours.toFixed(1).replace(".", ",")} h, Tiefschlaf ${Math.round(s.last7.deep * 100)} % (sonst ${Math.round(s.avg.deep * 100)} %), REM ${Math.round(s.last7.rem * 100)} % (sonst ${Math.round(s.avg.rem * 100)} %). Schlafmangel beeinträchtigt Ausdauerleistung und Erholung.`,
      source: "fullagar",
    });
  }
  const pat = patterns(data, a);
  if (pat.sleepPerformance) {
    const { good, poor } = pat.sleepPerformance;
    const diff = poor.rel - good.rel;
    if (diff <= -0.02) {
      out.push({ level: "info", title: "Schlechter Schlaf kostet Effizienz", text: `Nach Nächten mit niedrigem Schlafscore lief deine Effizienz (Tempo je Herzschlag) ${pctFmt(diff)} gegenüber guten Nächten (n = ${poor.n}/${good.n}).`, source: "fullagar" });
    }
  }
  return out;
}
