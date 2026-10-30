// SVG bar chart, without a dependency nor `innerHTML`: nodes created one by one, colours through presentation
// attributes `fill="var(--series-N)"` (never `style=`: `style-src 'self'`), the design system's colours as fallback.
// Accessible: `role="img"` + `<title>`/`<desc>`, and the same data table in HTML under the chart.
import { t } from './i18n.js';

const SVG = 'http://www.w3.org/2000/svg';
/** Fallback = values of `design-system.css` (`--series-1..6`, `--series-other`), if the page does not load it. */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const OTHER = '#8b98a3';
/** @param {number} i */
const colour = (i) => (i < SERIES.length ? `var(--series-${i + 1}, ${SERIES[i]})` : `var(--series-other, ${OTHER})`);

/**
 * "Readable" scale: step 1, 2 or 5 × 10^k, top of the axis rounded to the step. Pure.
 * @param {number} max largest value
 * @param {number} [ticks] number of ticks aimed at
 * @returns {{ top: number, step: number }}
 */
export function scale(max, ticks = 4) {
  if (!(max > 0) || !Number.isFinite(max)) return { top: 1, step: 1 };
  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const f = raw / power;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
  return { top: Number((Math.ceil(max / step) * step).toPrecision(12)), step: Number(step.toPrecision(12)) };
}

/**
 * @param {string} name
 * @param {Record<string, string | number>} attrs
 * @param {string} [text]
 */
function el(name, attrs, text) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Grouped bars: one colour per series, one column per category. Replaces the content of `container`.
 * @param {Element} container
 * @param {{ title: string, description?: string, categories: string[], series: { name: string, values: number[] }[], unit?: string }} d
 */
export function barChart(container, d) {
  const W = 640; const H = 320; const m = { top: 24, bottom: 56, left: 56, right: 16 };
  const width = W - m.left - m.right; const height = H - m.top - m.bottom;
  const max = Math.max(0, ...d.series.flatMap((s) => s.values));
  const { top, step } = scale(max);
  const y = (/** @type {number} */ v) => m.top + height - (v / top) * height;
  const id = `chart-${Math.random().toString(36).slice(2, 8)}`;
  const fmt = (/** @type {number} */ v) => `${v.toLocaleString()}${d.unit ? ` ${d.unit}` : ''}`;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-labelledby': `${id}-title ${id}-desc`, class: 'chart' });
  svg.append(el('title', { id: `${id}-title` }, d.title));
  svg.append(el('desc', { id: `${id}-desc` }, d.description ?? t('chart.description', { series: d.series.length, categories: d.categories.length })));
  for (let v = 0; v <= top; v += step) {
    svg.append(el('line', { x1: m.left, x2: W - m.right, y1: y(v), y2: y(v), stroke: 'currentColor', 'stroke-opacity': v === 0 ? 0.6 : 0.15 }));
    svg.append(el('text', { x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: 'currentColor' }, v.toLocaleString()));
  }
  const column = width / Math.max(1, d.categories.length);
  const bar = Math.min(48, (column * 0.8) / Math.max(1, d.series.length));
  d.categories.forEach((cat, c) => {
    const x0 = m.left + c * column + (column - bar * d.series.length) / 2;
    d.series.forEach((s, i) => {
      const v = s.values[c] ?? 0;
      const r = el('rect', { x: x0 + i * bar, y: y(v), width: Math.max(1, bar - 2), height: Math.max(0, y(0) - y(v)), fill: colour(i), rx: 2 });
      r.append(el('title', {}, `${cat} — ${s.name}: ${fmt(v)}`));
      svg.append(r);
    });
    svg.append(el('text', { x: m.left + c * column + column / 2, y: H - m.bottom + 18, 'text-anchor': 'middle', 'font-size': 12, fill: 'currentColor' }, cat));
  });

  const table = document.createElement('table');
  table.className = 'chart-data';
  const caption = document.createElement('caption'); caption.textContent = d.title; table.append(caption);
  const thead = table.createTHead().insertRow();
  thead.append(th(t('chart.series')));
  for (const cat of d.categories) thead.append(th(cat));
  const tbody = table.createTBody();
  d.series.forEach((s, i) => {
    const tr = tbody.insertRow();
    const name = th(s.name, 'row');
    const bullet = el('svg', { width: 12, height: 12, 'aria-hidden': 'true', class: 'chart-bullet' });
    bullet.append(el('rect', { width: 12, height: 12, rx: 2, fill: colour(i) }));
    name.prepend(bullet, ' ');
    tr.append(name);
    for (let c = 0; c < d.categories.length; c++) tr.insertCell().textContent = fmt(s.values[c] ?? 0);
  });
  container.replaceChildren(svg, table);
}

/** @param {string} text @param {'col' | 'row'} [scope] */
function th(text, scope = 'col') {
  const e = document.createElement('th');
  e.scope = scope;
  e.textContent = text;
  return e;
}
