// Custom ticker-list RRG scan.
//
// Same StockCharts data path and the same metric derivation as the sector
// scanner — just an arbitrary symbol list against a benchmark of the user's
// choosing, with no sector layer.

import { fetchRRG, deriveMetrics, angleQuality, percentile } from './rrg.js';

const QUAD_WEIGHT = { Improving: 1.3, Lagging: 1.2, Leading: 1.0, Weakening: 0.9 };
const MAX_QUAD_WEIGHT = 1.3;
const r2 = (x) => Math.round(x * 100) / 100;

/** Accepts commas, spaces, newlines, tabs, and $-prefixed symbols. */
export function parseSymbols(raw) {
  if (!raw) return [];
  const seen = new Set();
  const out = [];
  for (let t of String(raw).split(/[\s,;]+/)) {
    t = t.trim().toUpperCase().replace(/^\$/, '');
    if (!t) continue;
    if (!/^[A-Z][A-Z0-9.\-/]{0,9}$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Score a flat list. Same shape as the sector scanner minus the sector term,
 * reweighted so the remaining components still sum to 1: direction quality
 * stays the largest single factor, and the quadrant weight still rewards
 * early rotation. Divided by the max weight so nothing clips at 100.
 */
export function scoreRows(rows) {
  const mags = rows.map((r) => r.magnitude);
  const chgs = rows.map((r) => r.chg);
  return rows.map((r) => {
    const angQ = r.dRatio > 0 && r.dMom > 0 ? angleQuality(r.angle) : 0;
    const strQ = percentile(mags, r.magnitude);
    const chgQ = percentile(chgs, r.chg);
    const raw = 0.45 * angQ + 0.275 * strQ + 0.275 * chgQ;
    const qw = QUAD_WEIGHT[r.quadrant] ?? 1;
    return {
      ...r,
      upAndRight: r.dRatio > 0 && r.dMom > 0,
      components: {
        angleQuality: r2(angQ * 100),
        vectorStrength: r2(strQ * 100),
        tailChange: r2(chgQ * 100),
        quadrantWeight: qw,
      },
      score: r2((100 * raw * qw) / MAX_QUAD_WEIGHT),
    };
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const q = req.query || {};
  const symbols = parseSymbols(q.symbols);
  const benchmark = parseSymbols(q.benchmark)[0] || 'SPY';
  const tail = Math.max(2, Math.min(30, parseInt(q.tail, 10) || 7));
  const months = Math.max(1, Math.min(24, parseInt(q.months, 10) || 3));
  const period = ['d', 'w'].includes(q.period) ? q.period : 'd';
  const minAngle = q.minAngle !== undefined ? parseFloat(q.minAngle) : 0;

  if (!symbols.length) {
    return res.status(400).json({ ok: false, error: 'No valid tickers supplied' });
  }
  if (symbols.length > 200) {
    return res.status(400).json({ ok: false, error: 'Limit is 200 tickers per list' });
  }

  const t0 = Date.now();
  try {
    const payload = await fetchRRG(symbols, benchmark, months, period);
    const m = deriveMetrics(payload, symbols, tail);

    // Symbols StockCharts had no data for (typos, delistings) — surfaced so a
    // bad ticker is visible rather than silently dropped from the grid.
    const got = new Set(m.rows.map((r) => r.symbol));
    const missing = symbols.filter((s) => !got.has(s));

    const scored = scoreRows(m.rows).sort((a, b) => b.score - a.score);
    const filtered = minAngle > 0 ? scored.filter((r) => r.upAndRight && r.angle >= minAngle) : scored;

    res.status(200).json({
      ok: true,
      asOf: m.asOf,
      asOfDate: (m.asOf || '').slice(0, 10),
      benchmark,
      requested: symbols.length,
      resolved: m.rows.length,
      missing,
      upAndRightCount: scored.filter((r) => r.upAndRight).length,
      elapsedMs: Date.now() - t0,
      params: { tail, months, period, minAngle, benchmark },
      rows: filtered,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
}
