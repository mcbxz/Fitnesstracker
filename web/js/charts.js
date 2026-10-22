// Schlanke SVG-Diagramme mit Hover-Tooltip, ohne externe Bibliothek.

const NS = "http://www.w3.org/2000/svg";
const fmtDate = (k) => new Date(`${k}T12:00:00`).toLocaleDateString("de-DE", { day: "2-digit", month: "short" });

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function niceMax(v) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function frame(container, height) {
  container.innerHTML = "";
  const width = Math.max(280, container.clientWidth || 600);
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" }, container);
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.hidden = true;
  container.appendChild(tip);
  return { svg, tip, width };
}

function yAxis(svg, { left, right, top, bottom, max, ticks = 4 }) {
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const y = bottom - ((bottom - top) * i) / ticks;
    el("line", { x1: left, x2: right, y1: y, y2: y, class: i === 0 ? "baseline" : "gridline" }, svg);
    el("text", { x: left - 8, y: y + 4, "text-anchor": "end" }, svg).textContent = Math.round(v);
  }
}

function showTip(tip, container, x, y, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const half = tip.offsetWidth / 2;
  tip.style.left = `${Math.min(container.clientWidth - half, Math.max(half, x))}px`;
  tip.style.top = `${y}px`;
}

const row = (color, label, value) =>
  `<div class="row">${color ? `<span class="dot" style="background:${color}"></span>` : ""}${label}<strong>${value}</strong></div>`;

// Fitness (CTL) und Ermüdung (ATL) als Linien, Tageslast als Balken – eine gemeinsame Achse (TRIMP-Punkte).
export function pmcChart(container, model) {
  const H = 240;
  const { svg, tip, width } = frame(container, H);
  const m = { left: 34, right: 8, top: 10, bottom: 24 };
  const r = width - m.right;
  const b = H - m.bottom;
  const max = niceMax(Math.max(...model.map((d) => Math.max(d.ctl, d.atl, d.load))));
  yAxis(svg, { left: m.left, right: r, top: m.top, bottom: b, max });

  const step = (r - m.left) / model.length;
  const x = (i) => m.left + step * (i + 0.5);
  const y = (v) => b - (v / max) * (b - m.top);

  const bw = Math.max(1, step - 2);
  model.forEach((d, i) => {
    if (d.load > 0) el("rect", { x: x(i) - bw / 2, y: y(d.load), width: bw, height: b - y(d.load), rx: Math.min(2, bw / 2), fill: "var(--bar)" }, svg);
  });
  for (const [key, color] of [["ctl", "var(--series-1)"], ["atl", "var(--series-2)"]]) {
    const d = model.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
    el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  }
  for (let i = model.length - 1; i >= 0; i -= 21) {
    el("text", { x: x(i), y: H - 6, "text-anchor": "middle" }, svg).textContent = fmtDate(model[i].date);
  }

  const cross = el("line", { y1: m.top, y2: b, class: "crosshair", visibility: "hidden" }, svg);
  const dots = ["var(--series-1)", "var(--series-2)"].map((c) =>
    el("circle", { r: 4, fill: c, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" }, svg));
  const hit = el("rect", { x: m.left, y: 0, width: r - m.left, height: H, fill: "transparent" }, svg);

  hit.addEventListener("pointermove", (e) => {
    const scale = width / svg.getBoundingClientRect().width;
    const px = (e.clientX - svg.getBoundingClientRect().left) * scale;
    const i = Math.max(0, Math.min(model.length - 1, Math.floor((px - m.left) / step)));
    const d = model[i];
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    [d.ctl, d.atl].forEach((v, k) => {
      dots[k].setAttribute("cx", x(i));
      dots[k].setAttribute("cy", y(v));
      dots[k].setAttribute("visibility", "visible");
    });
    showTip(tip, container, x(i) / scale, y(Math.max(d.ctl, d.atl)) / scale,
      `<b>${fmtDate(d.date)}</b>${row("var(--series-1)", "Fitness", Math.round(d.ctl))}${row("var(--series-2)", "Ermüdung", Math.round(d.atl))}${row("var(--bar)", "Tageslast", Math.round(d.load))}${row("", "Form", Math.round(d.tsb))}`);
  });
  hit.addEventListener("pointerleave", () => {
    tip.hidden = true;
    cross.setAttribute("visibility", "hidden");
    dots.forEach((dot) => dot.setAttribute("visibility", "hidden"));
  });
}

export function weekChart(container, weeks) {
  const H = 200;
  const { svg, tip, width } = frame(container, H);
  const m = { left: 34, right: 8, top: 18, bottom: 24 };
  const r = width - m.right;
  const b = H - m.bottom;
  const max = niceMax(Math.max(...weeks.map((w) => w.minutes)));
  yAxis(svg, { left: m.left, right: r, top: m.top, bottom: b, max });
  const step = (r - m.left) / weeks.length;
  const bw = Math.min(36, step * 0.6);

  weeks.forEach((w, i) => {
    const cx = m.left + step * (i + 0.5);
    const h = (w.minutes / max) * (b - m.top);
    const current = i === weeks.length - 1;
    if (h > 0) {
      el("path", {
        d: `M${cx - bw / 2},${b} V${b - h + 4} q0,-4 4,-4 H${cx + bw / 2 - 4} q4,0 4,4 V${b} Z`,
        fill: "var(--series-1)",
        opacity: current ? 0.45 : 1,
      }, svg);
    }
    if (step >= 48 || (weeks.length - 1 - i) % 2 === 0) {
      el("text", { x: cx, y: H - 6, "text-anchor": "middle" }, svg).textContent = current ? "aktuell" : fmtDate(w.start);
    }
    if (i === weeks.length - 2) {
      el("text", { x: cx, y: b - h - 6, "text-anchor": "middle", style: "fill:var(--ink-2)" }, svg).textContent = `${Math.round(w.minutes)}`;
    }
    const hit = el("rect", { x: cx - step / 2, y: m.top, width: step, height: b - m.top, fill: "transparent" }, svg);
    hit.addEventListener("pointerenter", () => {
      const scale = width / svg.getBoundingClientRect().width;
      showTip(tip, container, cx / scale, (b - h) / scale,
        `<b>Woche ab ${fmtDate(w.start)}${current ? " (laufend)" : ""}</b>${row("var(--series-1)", "Dauer", `${Math.round(w.minutes)} min`)}${row("", "Distanz", `${w.km.toFixed(1).replace(".", ",")} km`)}${row("", "Einheiten", w.count)}`);
    });
    hit.addEventListener("pointerleave", () => (tip.hidden = true));
  });
}

export function sparkline(container, values, { min = 60, max = 200 } = {}) {
  const H = 64;
  const width = Math.max(200, container.clientWidth || 300);
  if (!container.firstChild) el("svg", { viewBox: `0 0 ${width} ${H}`, preserveAspectRatio: "none" }, container);
  const svg = container.firstChild;
  svg.setAttribute("viewBox", `0 0 ${width} ${H}`);
  svg.innerHTML = "";
  if (values.length < 2) return;
  const lo = Math.min(min, ...values) - 5;
  const hi = Math.max(max, ...values);
  const x = (i) => (i / (values.length - 1)) * width;
  const y = (v) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
  el("path", { d: values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(""), fill: "none", stroke: "var(--critical)", "stroke-width": 2, "stroke-linejoin": "round" }, svg);
}
