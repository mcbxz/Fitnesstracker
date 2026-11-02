// Diagramme im Neon-Stil für den Reiter "Statistik": Ring, Balken, Trendfläche, Donut,
// Erholungs-Gauge, Schlafphasen-Verlauf (Hypnogramm) und Herzfrequenz im Tagesverlauf.
import { el, frame, niceMax, showTip, row, fmtDate } from "./charts.js";

const NS = "http://www.w3.org/2000/svg";
const de = (x, d = 0) => x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
export const short = (v) => (v >= 1000 ? `${de(v / 1000, 1)}K` : de(Math.round(v)));

function svgEl(container, w, h) {
  container.innerHTML = "";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  container.appendChild(svg);
  return svg;
}

const polar = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

// Großer Fortschrittsring (z. B. Schritte im Verhältnis zum Ziel)
export function heroRing(container, value, goal, { unit = "", label = "" } = {}) {
  const svg = svgEl(container, 240, 240);
  container.className = "hero-ring";
  const p = goal ? Math.min(1, value / goal) : 0;
  el("circle", { cx: 120, cy: 120, r: 100, fill: "none", stroke: "rgba(120,160,230,0.15)", "stroke-width": 14 }, svg);
  if (p > 0) {
    el("path", { d: arc(120, 120, 100, 0, Math.max(1, p * 359.9)), fill: "none", stroke: "url(#ring-steps)", "stroke-width": 14, "stroke-linecap": "round", filter: "url(#glow)" }, svg);
  }
  const t = (y, cls, txt, size) => {
    const n = el("text", { x: 120, y, "text-anchor": "middle", class: cls, "font-size": size }, svg);
    n.textContent = txt;
  };
  if (label) t(78, "small", label.toUpperCase(), 13);
  t(130, "big", de(Math.round(value)), value >= 100000 ? 36 : 46);
  if (goal) t(160, "small", `/ ${de(Math.round(goal))}${unit}`, 15);
  if (goal) t(190, "pct", `${Math.round((value / goal) * 100)} %`, 20);
}

// Balken je Tag mit Wertbeschriftung; der hervorgehobene Tag erhält eine Akzentfarbe
export function dayBars(container, days, key, { gradient = "url(#grad-cyan)", highlight = null, highlightGradient = "url(#grad-lime)", format = short, unit = "" } = {}) {
  const H = 230;
  const { svg, tip, width } = frame(container, H);
  const m = { left: 6, right: 6, top: 26, bottom: 26 };
  const r = width - m.right;
  const b = H - m.bottom;
  const vals = days.map((d) => d[key] ?? 0);
  const max = niceMax(Math.max(1, ...vals));
  const step = (r - m.left) / days.length;
  const bw = Math.max(3, Math.min(30, step * 0.58));
  const many = days.length > 10;
  el("line", { x1: m.left, x2: r, y1: b, y2: b, class: "baseline" }, svg);
  days.forEach((d, i) => {
    const cx = m.left + step * (i + 0.5);
    const v = d[key];
    const h = v ? (v / max) * (b - m.top) : 0;
    const hl = d.date === highlight;
    if (h > 0) {
      el("path", {
        d: `M${cx - bw / 2},${b} V${b - h + 4} q0,-4 4,-4 H${cx + bw / 2 - 4} q4,0 4,4 V${b} Z`,
        fill: hl ? highlightGradient : gradient,
        filter: hl ? "url(#glow)" : null,
      }, svg);
      if (!many || hl) {
        el("text", { x: cx, y: b - h - 7, "text-anchor": "middle", style: `fill:${hl ? "var(--c-lime)" : "var(--ink-2)"};font-weight:600` }, svg).textContent = format(v);
      }
    }
    const lbl = many ? (i % 5 === 0 || i === days.length - 1 ? String(Number(d.date.slice(8))) : "") : new Date(`${d.date}T12:00:00`).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
    if (lbl) el("text", { x: cx, y: H - 6, "text-anchor": "middle", style: hl ? "fill:var(--c-lime)" : "" }, svg).textContent = lbl;
    const hit = el("rect", { x: cx - step / 2, y: m.top - 20, width: step, height: b - m.top + 20, fill: "transparent" }, svg);
    hit.addEventListener("pointerenter", () => {
      const scale = width / svg.getBoundingClientRect().width;
      showTip(tip, container, cx / scale, (b - h) / scale, `<b>${fmtDate(d.date)}</b>${row("", "Wert", v != null ? `${de(Math.round(v))}${unit}` : "–")}`);
    });
    hit.addEventListener("pointerleave", () => (tip.hidden = true));
  });
}

// Trendlinie mit leuchtender Fläche und Punkten (wie "Aktivitätstrend")
export function areaTrend(container, days, key, { color = "var(--c-cyan)", area = "url(#area-cyan)", unit = "", decimals = 0 } = {}) {
  const H = 260;
  const { svg, tip, width } = frame(container, H);
  const pts = days.map((d, i) => ({ i, d, v: d[key] })).filter((p) => p.v != null);
  if (pts.length < 2) {
    container.innerHTML = '<p class="hint">Für diesen Zeitraum liegen zu wenige Werte vor.</p>';
    return;
  }
  const m = { left: 40, right: 14, top: 14, bottom: 26 };
  const r = width - m.right;
  const b = H - m.bottom;
  const max = niceMax(Math.max(...pts.map((p) => p.v)));
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    const y = b - (v / max) * (b - m.top);
    el("line", { x1: m.left, x2: r, y1: y, y2: y, class: k ? "gridline" : "baseline" }, svg);
    el("text", { x: m.left - 8, y: y + 4, "text-anchor": "end" }, svg).textContent = short(v);
  }
  const step = (r - m.left) / Math.max(1, days.length - 1);
  const x = (i) => m.left + step * i;
  const y = (v) => b - (v / max) * (b - m.top);
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  el("path", { d: `${line} L${x(pts.at(-1).i)},${b} L${x(pts[0].i)},${b} Z`, fill: area, stroke: "none" }, svg);
  el("path", { d: line, class: "line", fill: "none", stroke: color, "stroke-width": 2.2, "stroke-linejoin": "round" }, svg);
  const showDots = days.length <= 14;
  pts.forEach((p, k) => {
    if (showDots || k === pts.length - 1) {
      el("circle", { cx: x(p.i), cy: y(p.v), r: k === pts.length - 1 ? 6 : 4.5, fill: "var(--surface)", stroke: color, "stroke-width": 2 }, svg);
    }
  });
  const every = days.length > 10 ? 5 : 1;
  days.forEach((d, i) => {
    if (i % every && i !== days.length - 1) return;
    const lbl = days.length > 10 ? String(Number(d.date.slice(8))) : new Date(`${d.date}T12:00:00`).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
    el("text", { x: x(i), y: H - 6, "text-anchor": "middle" }, svg).textContent = lbl;
  });
  const cross = el("line", { y1: m.top, y2: b, class: "crosshair", visibility: "hidden" }, svg);
  const hit = el("rect", { x: m.left - step / 2, y: 0, width: r - m.left + step, height: H, fill: "transparent" }, svg);
  hit.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const scale = width / rect.width;
    const i = Math.round(((e.clientX - rect.left) * scale - m.left) / step);
    const p = pts.reduce((best, q) => (Math.abs(q.i - i) < Math.abs(best.i - i) ? q : best), pts[0]);
    cross.setAttribute("x1", x(p.i));
    cross.setAttribute("x2", x(p.i));
    cross.setAttribute("visibility", "visible");
    showTip(tip, container, x(p.i) / scale, y(p.v) / scale, `<b>${fmtDate(p.d.date)}</b>${row(color, "Wert", `${de(p.v, decimals)}${unit}`)}`);
  });
  hit.addEventListener("pointerleave", () => {
    tip.hidden = true;
    cross.setAttribute("visibility", "hidden");
  });
}

// Donut mit 2-px-Lücken zwischen den Segmenten
export function donut(container, items, { center = "", centerSub = "" } = {}) {
  const svg = svgEl(container, 200, 200);
  const total = items.reduce((s, x) => s + x.value, 0);
  el("circle", { cx: 100, cy: 100, r: 76, fill: "none", stroke: "rgba(120,160,230,0.12)", "stroke-width": 26 }, svg);
  let a = 0;
  for (const it of items) {
    const span = total ? (it.value / total) * 360 : 0;
    if (span > 2) {
      const path = el("path", { d: arc(100, 100, 76, a + 1, a + span - 1), fill: "none", stroke: it.color, "stroke-width": 26, filter: "url(#glow)" }, svg);
      const title = document.createElementNS(NS, "title");
      title.textContent = `${it.label}: ${Math.round((it.value / total) * 100)} %`;
      path.appendChild(title);
    }
    a += span;
  }
  if (center) {
    el("text", { x: 100, y: centerSub ? 102 : 108, "text-anchor": "middle", class: "donut-center", "font-size": 22 }, svg).textContent = center;
  }
  if (centerSub) el("text", { x: 100, y: 122, "text-anchor": "middle", "font-size": 12, style: "fill:var(--muted)" }, svg).textContent = centerSub;
}

// Halbkreis-Gauge (270°) für Erholung/Readiness
export function gauge(container, score, label, color) {
  const svg = svgEl(container.querySelector(".gauge-svg") || container, 200, 170);
  el("path", { d: arc(100, 100, 78, -135, 135), fill: "none", stroke: "rgba(120,160,230,0.15)", "stroke-width": 12, "stroke-linecap": "round" }, svg);
  if (score != null) {
    el("path", { d: arc(100, 100, 78, -135, -135 + Math.max(2, (score / 100) * 270)), fill: "none", stroke: color, "stroke-width": 12, "stroke-linecap": "round", filter: "url(#glow)" }, svg);
  }
  el("text", { x: 100, y: 108, "text-anchor": "middle", class: "gauge-value", "font-size": 40 }, svg).textContent = score != null ? `${score}%` : "–";
  el("text", { x: 100, y: 134, "text-anchor": "middle", class: "gauge-label", "font-size": 15 }, svg).textContent = label;
}

// Schlafphasen-Verlauf einer Nacht als Stufendiagramm
const LEVEL_ROW = { awake: 0, rem: 1, light: 2, deep: 3 };
const LEVEL_COLOR = { awake: "var(--stage-awake)", rem: "var(--stage-rem)", light: "var(--stage-light)", deep: "var(--stage-deep)" };
export function hypnogram(container, night) {
  const H = 150;
  const { svg, width } = frame(container, H);
  const segs = night.segments;
  const total = segs.at(-1)[1];
  const m = { left: 4, right: 4, top: 6, bottom: 24 };
  const r = width - m.right;
  const rowH = (H - m.top - m.bottom) / 4;
  const x = (min) => m.left + (min / total) * (r - m.left);
  for (const [a, b, level] of segs) {
    const yy = m.top + LEVEL_ROW[level] * rowH;
    el("rect", { x: x(a), y: yy + 2, width: Math.max(1, x(b) - x(a)), height: rowH - 4, rx: 2, fill: LEVEL_COLOR[level], opacity: 0.95, filter: "url(#glow)" }, svg);
  }
  const [h0, mm0] = night.start.split(":").map(Number);
  const startMin = h0 * 60 + mm0;
  const firstTick = Math.ceil(startMin / 120) * 120;
  for (let t = firstTick; t - startMin <= total; t += 120) {
    const label = `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:00`;
    el("text", { x: x(t - startMin), y: H - 6, "text-anchor": "middle" }, svg).textContent = label;
  }
}

// Herzfrequenz im Tagesverlauf (144 Werte à 10 Minuten)
export function hrDayChart(container, values) {
  const H = 210;
  const { svg, tip, width } = frame(container, H);
  const pts = values.map((v, i) => ({ i, v })).filter((p) => p.v != null);
  const m = { left: 34, right: 8, top: 26, bottom: 24 };
  const r = width - m.right;
  const b = H - m.bottom;
  const lo = Math.floor(Math.min(...pts.map((p) => p.v)) / 20) * 20;
  const hi = Math.ceil(Math.max(...pts.map((p) => p.v)) / 20) * 20;
  const x = (i) => m.left + (i / 143) * (r - m.left);
  const y = (v) => b - ((v - lo) / (hi - lo)) * (b - m.top);
  for (let v = lo; v <= hi; v += 40) {
    el("line", { x1: m.left, x2: r, y1: y(v), y2: y(v), class: v === lo ? "baseline" : "gridline" }, svg);
    el("text", { x: m.left - 8, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = v;
  }
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  el("path", { d: `${line} L${x(pts.at(-1).i)},${b} L${x(pts[0].i)},${b} Z`, fill: "url(#area-pink)", stroke: "none" }, svg);
  el("path", { d: line, class: "line", fill: "none", stroke: "var(--c-pink)", "stroke-width": 1.8, "stroke-linejoin": "round" }, svg);
  const peak = pts.reduce((a, p) => (p.v > a.v ? p : a), pts[0]);
  el("line", { x1: x(peak.i), x2: x(peak.i), y1: y(peak.v), y2: b, class: "crosshair" }, svg);
  el("circle", { cx: x(peak.i), cy: y(peak.v), r: 5, fill: "var(--surface)", stroke: "var(--c-pink)", "stroke-width": 2, filter: "url(#glow)" }, svg);
  el("text", { x: x(peak.i), y: y(peak.v) - 10, "text-anchor": "middle", style: "fill:var(--ink);font-weight:600" }, svg).textContent = peak.v;
  for (let h = 0; h <= 24; h += 6) {
    el("text", { x: x(Math.min(143, h * 6)), y: H - 6, "text-anchor": h === 0 ? "start" : h === 24 ? "end" : "middle" }, svg).textContent = `${String(h).padStart(2, "0")}:00`;
  }
  const hit = el("rect", { x: m.left, y: 0, width: r - m.left, height: H, fill: "transparent" }, svg);
  hit.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const scale = width / rect.width;
    const i = Math.round((((e.clientX - rect.left) * scale - m.left) / (r - m.left)) * 143);
    const p = pts.reduce((best, q) => (Math.abs(q.i - i) < Math.abs(best.i - i) ? q : best), pts[0]);
    const t = `${String(Math.floor(p.i / 6)).padStart(2, "0")}:${String((p.i % 6) * 10).padStart(2, "0")}`;
    showTip(tip, container, x(p.i) / scale, y(p.v) / scale, `<b>${t} Uhr</b>${row("var(--c-pink)", "Puls", `${p.v} bpm`)}`);
  });
  hit.addEventListener("pointerleave", () => (tip.hidden = true));
}
