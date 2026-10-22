import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyze, trimp, performanceModel, acwr, estimateHrMax, suggestDays, tips, addDays, weekdayIndex, DEFAULT_PLAN,
} from "../web/js/analysis.js";
import { parseHeartRate } from "../web/js/bluetooth.js";
import { demoData } from "../web/js/demo.js";

const TODAY = "2026-10-22"; // Donnerstag

test("Datumshilfen", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(weekdayIndex("2026-10-19"), 0); // Montag
  assert.equal(weekdayIndex("2026-10-25"), 6); // Sonntag
});

test("Maximalpuls nach Tanaka", () => {
  assert.equal(estimateHrMax(40), 180);
});

test("TRIMP steigt mit der Intensität", () => {
  const p = { hrMax: 190, hrRest: 50, sex: "male" };
  const easy = trimp({ durationSec: 3600, avgHr: 130 }, p);
  const hard = trimp({ durationSec: 3600, avgHr: 170 }, p);
  assert.ok(hard > easy * 1.5);
  assert.ok(Math.abs(easy - 60 * (80 / 140) * 0.64 * Math.exp(1.92 * (80 / 140))) < 1e-9);
});

test("Fitness folgt konstanter Belastung", () => {
  const loads = Array.from({ length: 300 }, (_, i) => ({ date: String(i), load: 50 }));
  const last = performanceModel(loads).at(-1);
  assert.ok(Math.abs(last.ctl - 50) < 0.5);
  assert.ok(Math.abs(last.atl - 50) < 0.01);
  assert.ok(Math.abs(acwr(loads) - 1) < 1e-9);
});

test("Niedrige Erholungswerte entschärfen die heutige Einheit", () => {
  const a = analyze(demoData(TODAY), TODAY);
  assert.equal(a.readiness.status, "low");
  const [today] = suggestDays(a, DEFAULT_PLAN);
  assert.equal(DEFAULT_PLAN.week[weekdayIndex(TODAY)].intensity, "moderate");
  assert.equal(today.intensity, "easy");
  assert.ok(today.changed);
  assert.ok(tips(a).some((t) => t.source === "plews"));
});

test("Keine zwei harten Tage in Folge und Tapering vor dem Wettkampf", () => {
  const a = analyze(demoData(TODAY), TODAY);
  a.readiness = { status: "good", reasons: [], score: 80 };
  const week = DEFAULT_PLAN.week.map(() => ({ sport: "run", intensity: "hard", durationMin: 60, title: "Intervalle" }));
  const days = suggestDays(a, { goal: "10 km", raceDate: addDays(TODAY, 6), week });
  for (let i = 1; i < days.length; i++) {
    const both = ["hard", "race"].includes(days[i].intensity) && ["hard", "race"].includes(days[i - 1].intensity);
    assert.ok(!both || days[i].intensity === "race", `Tag ${i}`);
  }
  assert.equal(days[6].intensity, "race");
  assert.ok(days[0].durationMin < 60);
});

test("Bluetooth-Herzfrequenz: 8- und 16-Bit-Format", () => {
  assert.equal(parseHeartRate(new DataView(new Uint8Array([0x00, 72]).buffer)), 72);
  assert.equal(parseHeartRate(new DataView(new Uint8Array([0x01, 0x2c, 0x01]).buffer)), 300);
});

import { last7Days, illnessScore, vo2maxTrend, pearson } from "../web/js/insights.js";
import { buildWorkout, toGarminWorkout, fitSteps, totalSeconds } from "../web/js/workouts.js";

test("Wöchentliche Bereitschaft aus HRV, Schlaf und Trainingsstress", () => {
  const a = analyze(demoData(TODAY), TODAY);
  assert.equal(a.readinessWeek.length, 7);
  const r = a.readinessWeek.at(-1);
  assert.deepEqual(Object.keys(r.parts).sort(), ["hrv", "load", "sleep"]);
  const expected = Math.round(r.parts.hrv * 0.4 + r.parts.sleep * 0.35 + r.parts.load * 0.25);
  assert.equal(r.score, expected);
  assert.ok(a.weeklyReadiness.score > r.score); // der Einbruch betrifft nur die letzten Tage
});

test("7-Tage-Übersicht enthält Schlaf und Belastung", () => {
  const data = demoData(TODAY);
  const rows = last7Days(data, analyze(data, TODAY));
  assert.equal(rows.length, 7);
  assert.equal(rows.at(-1).date, TODAY);
  assert.ok(rows.every((r) => r.sleepScore != null && r.deepPct > 0 && r.remPct > 0));
  assert.ok(rows.some((r) => r.trimp > 0 && r.garminLoad > 0));
});

test("Illness-Score erkennt das Warnmuster der Beispieldaten", () => {
  const data = demoData(TODAY);
  const ill = illnessScore(data.daily, TODAY);
  assert.equal(ill.level, "high");
  assert.ok(ill.reasons.some((x) => x.startsWith("Ruhepuls")));
  const calm = illnessScore(data.daily, addDays(TODAY, -5));
  assert.equal(calm.level, "normal");
});

test("VO2max-Trend und Korrelation", () => {
  const v = vo2maxTrend(demoData(TODAY), TODAY);
  assert.ok(v.delta84 > 1);
  assert.ok(Math.abs(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) - 1) < 1e-12);
});

test("Strukturiertes Intervall-Workout für Garmin Connect und FIT", () => {
  const p = { hrMax: 190, hrRest: 50, lt1Pct: 0.8, lt2Pct: 0.88 };
  const w = buildWorkout({ sport: "run", intensity: "hard", durationMin: 55, title: "Intervalle", date: TODAY }, p);
  assert.equal(totalSeconds(w.steps), 55 * 60);
  const repeat = w.steps.find((s) => s.kind === "repeat");
  assert.deepEqual(repeat.steps[0].hr, [171, 181]); // 90–95 % HFmax

  const g = toGarminWorkout(w);
  const steps = g.workoutSegments[0].workoutSteps;
  assert.equal(g.sportType.sportTypeKey, "running");
  assert.equal(steps[1].type, "RepeatGroupDTO");
  assert.deepEqual(steps.map((s) => s.stepOrder), [1, 2, 5]);
  assert.deepEqual(steps[1].workoutSteps.map((s) => s.stepOrder), [3, 4]);

  const f = fitSteps(w.steps);
  const rep = f.find((s) => s.durationType === "repeatUntilStepsCmplt");
  assert.equal(rep.durationValue, 1);
  assert.equal(rep.targetValue, repeat.n);
  assert.equal(f[1].customTargetValueLow, 171 + 100);

  assert.equal(buildWorkout({ sport: "strength", intensity: "easy", durationMin: 40, date: TODAY }, p), null);
});
