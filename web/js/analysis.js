// Trainingsanalyse: Belastung, Fitness/Ermüdung/Form, Intensitätsverteilung,
// Erholungsbereitschaft sowie Tipps und Vorschläge für die kommenden Tage.
// Reine Funktionen ohne DOM-Zugriff, damit sie auch mit Node getestet werden können.

export const INTENSITIES = {
  rest: "Ruhetag",
  easy: "Locker",
  moderate: "Moderat",
  hard: "Intensiv",
  long: "Lang & locker",
  race: "Wettkampf",
};

export const SPORTS = {
  run: "Laufen",
  bike: "Radfahren",
  swim: "Schwimmen",
  strength: "Kraft",
  mobility: "Mobilität",
  walk: "Gehen",
  other: "Sonstiges",
  rest: "Pause",
};

const HARD = new Set(["hard", "race"]);

// ---------- Datum ----------

export function dateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + n));
}

export function weekdayIndex(key) {
  const [y, m, d] = key.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7; // Montag = 0
}

export function daysBetween(a, b) {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const sd = (xs) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------- Profil ----------

// Maximalpuls nach Tanaka et al. 2001: 208 − 0,7 × Alter
export function estimateHrMax(age) {
  return Math.round(208 - 0.7 * age);
}

export function resolveProfile(profile = {}, daily = []) {
  const rhr = daily.slice(-14).map((d) => d.restingHr).filter(Boolean);
  const hrMax = profile.hrMax || profile.observedHrMax || (profile.age ? estimateHrMax(profile.age) : 190);
  const hrRest = profile.hrRest || (rhr.length ? Math.round(mean(rhr)) : 60);
  return {
    sex: "male",
    lt1Pct: 0.8,
    lt2Pct: 0.88,
    ...profile,
    hrMax,
    hrRest,
    hrMaxSource: profile.hrMax ? "manuell" : profile.observedHrMax ? "gemessen" : "Tanaka-Formel",
  };
}

export function hrZones(p) {
  return {
    low: [Math.round(p.hrRest + 0.5 * (p.hrMax - p.hrRest)), Math.round(p.lt1Pct * p.hrMax)],
    moderate: [Math.round(p.lt1Pct * p.hrMax), Math.round(p.lt2Pct * p.hrMax)],
    high: [Math.round(p.lt2Pct * p.hrMax), p.hrMax],
  };
}

// ---------- Belastung ----------

// Banister-TRIMP (Morton, Fitz-Clarke & Banister 1990). Ohne Puls: grobe Schätzung über die Dauer.
export function trimp(act, p) {
  const minutes = (act.durationSec || 0) / 60;
  if (act.avgHr && p.hrMax > p.hrRest) {
    const r = clamp((act.avgHr - p.hrRest) / (p.hrMax - p.hrRest), 0, 1);
    const [a, b] = p.sex === "female" ? [0.86, 1.67] : [0.64, 1.92];
    return minutes * r * a * Math.exp(b * r);
  }
  const factor = { strength: 0.7, mobility: 0.3, walk: 0.4 }[act.sport] ?? 0.8;
  return minutes * factor;
}

export function dailyLoads(activities, p, endKey, days) {
  const byDay = new Map();
  for (const a of activities) {
    const k = a.start.slice(0, 10);
    byDay.set(k, (byDay.get(k) || 0) + trimp(a, p));
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = addDays(endKey, -i);
    out.push({ date: k, load: byDay.get(k) || 0 });
  }
  return out;
}

// Fitness (CTL, 42 Tage) und Ermüdung (ATL, 7 Tage) als exponentiell gewichtete Mittel;
// Form (TSB) = Fitness − Ermüdung des Vortags (Impulse-Response-Modell nach Banister).
export function performanceModel(loads) {
  const kCtl = 1 - Math.exp(-1 / 42);
  const kAtl = 1 - Math.exp(-1 / 7);
  let ctl = 0;
  let atl = 0;
  return loads.map(({ date, load }) => {
    const tsb = ctl - atl;
    ctl += (load - ctl) * kCtl;
    atl += (load - atl) * kAtl;
    return { date, load, ctl, atl, tsb };
  });
}

// Verhältnis akuter (7 Tage) zu chronischer (28 Tage) Belastung nach Gabbett 2016
export function acwr(loads) {
  const last = loads.slice(-28).map((d) => d.load);
  if (last.length < 28) return NaN;
  const chronic = last.reduce((s, x) => s + x, 0) / 4;
  const acute = last.slice(-7).reduce((s, x) => s + x, 0);
  return chronic > 0 ? acute / chronic : NaN;
}

// Monotonie der letzten 7 Tage nach Foster 1998: Mittelwert / Standardabweichung der Tageslast
export function monotony(loads) {
  const week = loads.slice(-7).map((d) => d.load);
  const s = sd(week);
  return s > 0 ? mean(week) / s : NaN;
}

// ---------- Intensität ----------

export function intensitySplit(act, p) {
  if (Array.isArray(act.intensitySec)) return act.intensitySec;
  const dur = act.durationSec || 0;
  if (!act.avgHr) return [dur, 0, 0];
  const pct = act.avgHr / p.hrMax;
  if (pct < p.lt1Pct) return [dur, 0, 0];
  if (pct < p.lt2Pct) return [0, dur, 0];
  return [0, 0, dur];
}

export function intensityDistribution(activities, p, fromKey) {
  const sum = [0, 0, 0];
  for (const a of activities) {
    if (a.start.slice(0, 10) < fromKey || ["strength", "mobility"].includes(a.sport)) continue;
    intensitySplit(a, p).forEach((v, i) => (sum[i] += v));
  }
  const total = sum[0] + sum[1] + sum[2];
  return { seconds: sum, share: sum.map((v) => (total ? v / total : 0)), total };
}

export function weeklyVolume(activities, endKey, weeks) {
  const monday = addDays(endKey, -weekdayIndex(endKey));
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(monday, -7 * w);
    const end = addDays(start, 6);
    const acts = activities.filter((a) => {
      const k = a.start.slice(0, 10);
      return k >= start && k <= end;
    });
    out.push({
      start,
      minutes: acts.reduce((s, a) => s + (a.durationSec || 0) / 60, 0),
      km: acts.reduce((s, a) => s + (a.distanceM || 0) / 1000, 0),
      count: acts.length,
      strengthDays: new Set(acts.filter((a) => a.sport === "strength").map((a) => a.start.slice(0, 10))).size,
    });
  }
  return out;
}

// ---------- Erholung / Bereitschaft ----------

// Bereitschaft aus HRV (40 %), Schlaf (35 %) und akutem Trainingsstress (25 %).
// HRV und Ruhepuls werden mit dem individuellen Normalbereich (Mittelwert ± 1 SD der
// vorangegangenen 28 Tage) verglichen, angelehnt an Plews et al. 2013; der akute
// Trainingsstress ergibt sich aus der Form (TSB) des Banister-Modells.
export function readinessFor(daily, model, key) {
  const today = daily.find((d) => d.date === key);
  const day = model.find((m) => m.date === key);
  const prior = daily.filter((d) => d.date < key).slice(-28);
  const reasons = [];
  const parts = {};

  const hrvBase = prior.map((d) => d.hrv).filter(Boolean);
  if (today?.hrv && hrvBase.length >= 7) {
    const m = mean(hrvBase);
    const s = sd(hrvBase) || 1;
    const z = (today.hrv - m) / s;
    parts.hrv = clamp(60 + z * 20, 0, 100);
    const range = `${Math.round(m - s)}–${Math.round(m + s)} ms`;
    reasons.push(z < -1
      ? `HRV (Herzfrequenzvariabilität) ${today.hrv} ms liegt unter deinem Normalbereich (${range})`
      : `HRV (Herzfrequenzvariabilität) ${today.hrv} ms im Normalbereich (${range})`);
    const rhrBase = prior.map((d) => d.restingHr).filter(Boolean);
    if (today.restingHr && rhrBase.length >= 7) {
      const diff = today.restingHr - mean(rhrBase);
      if (diff > 2) parts.hrv = clamp(parts.hrv - (diff - 2) * 4, 0, 100);
      if (diff >= 5) reasons.push(`Ruhepuls ${today.restingHr} bpm, ${Math.round(diff)} Schläge über deinem Mittel`);
    }
  }

  if (today?.sleepScore != null) parts.sleep = today.sleepScore;
  else if (today?.sleepHours) parts.sleep = clamp((today.sleepHours / 8) * 85, 0, 100);
  if (today?.sleepHours && today.sleepHours < 7) reasons.push(`Nur ${today.sleepHours.toFixed(1).replace(".", ",")} h Schlaf`);

  if (day) {
    parts.load = clamp(70 + day.tsb * 1.5, 0, 100);
    if (day.tsb < -20) reasons.push(`Hoher akuter Trainingsstress (Form ${Math.round(day.tsb)})`);
  }

  const weights = { hrv: 0.4, sleep: 0.35, load: 0.25 };
  const used = Object.keys(parts);
  if (parts.hrv === undefined && parts.sleep === undefined) {
    return { status: "unknown", score: null, reasons, parts, today };
  }
  const wsum = used.reduce((s, k) => s + weights[k], 0);
  const score = Math.round(used.reduce((s, k) => s + parts[k] * weights[k], 0) / wsum);
  const status = score < 50 ? "low" : score < 70 ? "normal" : "good";
  return { status, score, reasons, parts, today, date: key };
}

export function readinessSeries(daily, model, endKey, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(readinessFor(daily, model, addDays(endKey, -i)));
  return out;
}

export function weeklyReadiness(series) {
  const scores = series.map((r) => r.score).filter((x) => x != null);
  if (!scores.length) return null;
  const score = Math.round(mean(scores));
  return { score, status: score < 50 ? "low" : score < 70 ? "normal" : "good", days: scores.length };
}

// ---------- Gesamtanalyse ----------

export function analyze(data, todayKey = dateKey(new Date())) {
  const p = resolveProfile(data.profile, data.daily);
  const loads = dailyLoads(data.activities, p, todayKey, 150);
  const model = performanceModel(loads);
  const now = model[model.length - 1];
  const daily = data.daily || [];
  const readinessWeek = readinessSeries(daily, model, todayKey, 7);
  return {
    profile: p,
    zones: hrZones(p),
    model: model.slice(-90),
    ctl: now.ctl,
    atl: now.atl,
    tsb: now.ctl - now.atl,
    acwr: acwr(loads),
    monotony: monotony(loads),
    distribution: intensityDistribution(data.activities, p, addDays(todayKey, -27)),
    weeks: weeklyVolume(data.activities, todayKey, 8),
    readiness: readinessWeek[readinessWeek.length - 1],
    readinessWeek,
    weeklyReadiness: weeklyReadiness(readinessWeek),
    fullModel: model,
    todayKey,
  };
}

export function fatigueState(a) {
  if (a.tsb < -30 || a.acwr > 1.5) return "high";
  if (a.tsb < -15 || a.acwr > 1.3) return "elevated";
  if (a.tsb > 5 && a.acwr < 0.8) return "fresh";
  return "normal";
}

// ---------- Tipps ----------

export function tips(a) {
  const out = [];
  const [low, mod, high] = a.distribution.share;
  const pct = (x) => `${Math.round(x * 100)} %`;
  const fatigue = fatigueState(a);

  if (a.readiness.status === "low") {
    out.push({
      level: "warn",
      title: "Erholung hat heute Vorrang",
      text: `${a.readiness.reasons.join("; ")}. Bei deutlich erniedrigter HRV (Herzfrequenzvariabilität) ist eine lockere Einheit oder Pause sinnvoller als ein harter Reiz.`,
      source: "plews",
    });
  }
  if (a.acwr > 1.5) {
    out.push({
      level: "warn",
      title: "Belastung steigt zu schnell",
      text: `Die akute Belastung liegt beim ${a.acwr.toFixed(2).replace(".", ",")}-Fachen deines 4-Wochen-Mittels. Werte über 1,5 gehen mit einem erhöhten Verletzungsrisiko einher; Bereich 0,8–1,3 anstreben.`,
      source: "gabbett",
    });
  } else if (a.acwr < 0.8 && a.ctl > 5) {
    out.push({
      level: "info",
      title: "Belastung unter deinem Niveau",
      text: `Mit einem Verhältnis von ${a.acwr.toFixed(2).replace(".", ",")} trainierst du derzeit weniger als in den Vorwochen. Eine schrittweise Steigerung in den Bereich 0,8–1,3 erhält die Fitness.`,
      source: "gabbett",
    });
  }
  if (fatigue === "high" && a.readiness.status !== "low") {
    out.push({
      level: "warn",
      title: "Hohe Ermüdung",
      text: `Deine Form (TSB, Training Stress Balance) liegt bei ${Math.round(a.tsb)}. Plane 1–2 lockere Tage ein, damit sich die Trainingsreize in Anpassung umsetzen.`,
      source: "banister",
    });
  }
  if (a.distribution.total > 3600) {
    if (mod > 0.2 || low < 0.7) {
      out.push({
        level: "info",
        title: "Lockere Einheiten lockerer gestalten",
        text: `In den letzten 4 Wochen: ${pct(low)} locker, ${pct(mod)} moderat, ${pct(high)} intensiv. Ausdauersportler auf hohem Niveau trainieren etwa 80 % der Einheiten unterhalb der ersten Schwelle und setzen wenige, gezielte harte Reize. Lockere Läufe unter ${a.zones.low[1]} bpm halten.`,
        source: "seiler",
      });
    } else if (high < 0.05) {
      out.push({
        level: "info",
        title: "Gezielter intensiver Reiz fehlt",
        text: `Nur ${pct(high)} deiner Zeit liegt im intensiven Bereich. Ein bis zwei Intervalleinheiten pro Woche (z. B. 4 × 4 min bei 90–95 % HFmax (maximale Herzfrequenz)) verbessern die VO2max (maximale Sauerstoffaufnahme) wirksam.`,
        source: "helgerud",
      });
    } else {
      out.push({
        level: "good",
        title: "Intensitätsverteilung passt",
        text: `${pct(low)} locker, ${pct(mod)} moderat, ${pct(high)} intensiv – das entspricht weitgehend einer polarisierten Verteilung.`,
        source: "seiler",
      });
    }
  }
  if (a.monotony > 2) {
    out.push({
      level: "info",
      title: "Mehr Abwechslung",
      text: `Die Trainingsmonotonie der letzten 7 Tage beträgt ${a.monotony.toFixed(1).replace(".", ",")}. Werte über 2 gelten als Risikofaktor; klare Wechsel zwischen harten und lockeren Tagen einbauen.`,
      source: "foster",
    });
  }
  const lastFull = a.weeks[a.weeks.length - 2];
  if (lastFull && lastFull.minutes < 150) {
    out.push({
      level: "info",
      title: "Wöchentlicher Mindestumfang",
      text: `Letzte Woche: ${Math.round(lastFull.minutes)} min. Für Erwachsene werden mindestens 150–300 min moderate Ausdaueraktivität pro Woche empfohlen.`,
      source: "who",
    });
  }
  if (lastFull && lastFull.strengthDays < 2) {
    out.push({
      level: "info",
      title: "Krafttraining ergänzen",
      text: `Letzte Woche ${lastFull.strengthDays}× Krafttraining. Empfohlen sind muskelkräftigende Übungen an mindestens 2 Tagen pro Woche.`,
      source: "who",
    });
  }
  const t = a.readiness.today;
  if (t && t.sleepHours && t.sleepHours < 7 && a.readiness.status !== "low") {
    out.push({
      level: "info",
      title: "Schlaf als Trainingsfaktor",
      text: `Letzte Nacht ${t.sleepHours.toFixed(1).replace(".", ",")} h. Für Erwachsene werden regelmäßig mindestens 7 h Schlaf empfohlen.`,
      source: "sleep",
    });
  }
  return out;
}

// ---------- Vorschläge für die kommenden Tage ----------

function stimulus(s, z) {
  switch (s.intensity) {
    case "rest":
      return { text: "Vollständige Erholung oder lockere Mobilität.", source: "banister" };
    case "easy":
      return { text: `Grundlagenausdauer: Puls ${z.low[0]}–${z.low[1]} bpm, Sprechtempo.`, source: "seiler" };
    case "long":
      return { text: `Lange, gleichmäßige Einheit unter ${z.low[1]} bpm – Reiz für Fettstoffwechsel und Kapillarisierung.`, source: "seiler" };
    case "moderate":
      return { text: `Schwellenbereich ${z.moderate[0]}–${z.moderate[1]} bpm, z. B. 3 × 10 min mit 3 min Trabpause.`, source: "seiler" };
    case "hard":
      return { text: `Intervalle über ${z.high[0]} bpm, z. B. 4 × 4 min bei 90–95 % HFmax (maximale Herzfrequenz) mit 3 min aktiver Pause.`, source: "helgerud" };
    case "race":
      return { text: "Wettkampf – gut einlaufen, Tempo nach Plan.", source: "bosquet" };
    default:
      return { text: "", source: null };
  }
}

export function suggestDays(a, plan, days = 7) {
  const fatigue = fatigueState(a);
  const out = [];
  let prevHard = false;
  for (let i = 0; i < days; i++) {
    const date = addDays(a.todayKey, i);
    const base = plan.week[weekdayIndex(date)] || { sport: "rest", intensity: "rest", durationMin: 0, title: "" };
    const s = { ...base, date, planned: base, notes: [] };
    const toRace = plan.raceDate ? daysBetween(date, plan.raceDate) : NaN;

    if (toRace === 0) {
      Object.assign(s, { intensity: "race", title: plan.goal || "Wettkampf" });
    } else if (toRace > 0 && toRace <= 14 && s.intensity !== "rest") {
      s.durationMin = Math.round(s.durationMin * (toRace <= 7 ? 0.5 : 0.65));
      if (toRace <= 2 && HARD.has(s.intensity)) s.intensity = "easy";
      s.notes.push({ text: `Tapering: noch ${toRace} Tage bis zum Wettkampf – Umfang reduzieren, Intensität beibehalten.`, source: "bosquet" });
    }

    if (i === 0 && a.readiness.status === "low" && ["hard", "moderate", "long"].includes(s.intensity)) {
      s.intensity = "easy";
      s.durationMin = Math.round(s.durationMin * 0.7);
      s.notes.push({ text: "Erholungswerte heute niedrig – fordernde Einheit auf einen späteren Tag verschieben.", source: "plews" });
    }
    if (fatigue === "high" && i < 3 && ["hard", "moderate", "long"].includes(s.intensity)) {
      s.intensity = s.intensity === "long" ? "long" : "easy";
      s.durationMin = Math.round(s.durationMin * 0.75);
      s.notes.push({ text: "Hohe Ermüdung – Umfang und Intensität reduziert.", source: a.acwr > 1.5 ? "gabbett" : "banister" });
    } else if (fatigue === "elevated" && i < 2 && s.intensity === "hard") {
      s.durationMin = Math.round(s.durationMin * 0.85);
      s.notes.push({ text: "Erhöhte Ermüdung – ein Intervall weniger als geplant.", source: "banister" });
    } else if (fatigue === "fresh" && ["easy", "long"].includes(s.intensity) && !(toRace >= 0 && toRace <= 14)) {
      s.durationMin = Math.round(s.durationMin * 1.1);
      s.notes.push({ text: "Du bist ausgeruht – leicht verlängerte Einheit möglich.", source: "gabbett" });
    }
    if (prevHard && HARD.has(s.intensity) && s.intensity !== "race") {
      s.intensity = "easy";
      s.notes.push({ text: "Zwei harte Tage in Folge vermeiden – heute locker.", source: "seiler" });
    }

    s.stimulus = stimulus(s, a.zones);
    s.changed = s.intensity !== base.intensity || s.durationMin !== base.durationMin;
    if (s.intensity !== base.intensity && s.intensity !== "race") {
      s.title = `${SPORTS[s.sport]} ${INTENSITIES[s.intensity].toLowerCase()} (statt ${base.title || INTENSITIES[base.intensity]})`;
    }
    prevHard = HARD.has(s.intensity);
    out.push(s);
  }
  return out;
}

export const DEFAULT_PLAN = {
  goal: "Halbmarathon",
  raceDate: "",
  week: [
    { sport: "run", intensity: "easy", durationMin: 45, title: "Lockerer Dauerlauf" },
    { sport: "run", intensity: "hard", durationMin: 55, title: "Intervalle" },
    { sport: "strength", intensity: "easy", durationMin: 40, title: "Krafttraining" },
    { sport: "run", intensity: "moderate", durationMin: 50, title: "Schwellenlauf" },
    { sport: "rest", intensity: "rest", durationMin: 0, title: "Ruhetag" },
    { sport: "bike", intensity: "easy", durationMin: 60, title: "Lockere Radausfahrt" },
    { sport: "run", intensity: "long", durationMin: 95, title: "Langer Lauf" },
  ],
};
