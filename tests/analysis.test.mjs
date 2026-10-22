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
