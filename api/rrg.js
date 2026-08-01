// Sector Rotation Scanner — data engine
// Source of truth: StockCharts' own RRG data service (same endpoint the
// freecharts RRG app calls), so JdK RS-Ratio / RS-Momentum values match the
// site exactly rather than being re-derived.

const RRG_BASE = 'https://stockcharts.com/d-rrg/rrg';
const RRG_PAGE = 'https://stockcharts.com/freecharts/rrg/';
const BUNDLE_HOST = 'https://d.stockcharts.com/freecharts/rrg/';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const HDRS = {
  'User-Agent': UA,
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: RRG_PAGE,
};

// Warm-lambda cache for the group membership map.
let GROUP_CACHE = null;
let GROUP_CACHE_AT = 0;
const GROUP_TTL_MS = 6 * 60 * 60 * 1000;

// Fallback if the bundle layout ever changes. The 11 SPDR sector ETFs are
// stable; member lists are only ever read from the live bundle.
const SECTOR_FALLBACK = {
  key: 'sp500',
  benchmark: 'SPY',
  symbols: ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'],
};

const SECTOR_NAMES = {
  XLB: 'Materials',
  XLC: 'Communication Services',
  XLE: 'Energy',
  XLF: 'Financials',
  XLI: 'Industrials',
  XLK: 'Technology',
  XLP: 'Consumer Staples',
  XLRE: 'Real Estate',
  XLU: 'Utilities',
  XLV: 'Health Care',
  XLY: 'Consumer Discretionary',
};

async function getText(url) {
  const r = await fetch(url, { headers: HDRS });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

// ---------------------------------------------------------------------------
// Group membership: discovered live from the RRG app bundle so the universe
// tracks StockCharts' own sector membership instead of drifting from a
// hardcoded list.
// ---------------------------------------------------------------------------
async function loadGroups() {
  const now = Date.now();
  if (GROUP_CACHE && now - GROUP_CACHE_AT < GROUP_TTL_MS) return GROUP_CACHE;

  const html = await getText(RRG_PAGE);
  const m = html.match(/app\.[A-Za-z0-9_-]+\.bundle\.js/);
  if (!m) throw new Error('Could not locate RRG app bundle');
  const js = await getText(BUNDLE_HOST + m[0]);

  const groups = {};
  const re = /"([a-z0-9]+)",benchmarkSymbol:"([^"]+)",symbols:\[([^\]]+)\]/g;
  let g;
  while ((g = re.exec(js)) !== null) {
    const syms = g[3]
      .split(',')
      .map((s) => s.replace(/"/g, '').trim())
      .filter(Boolean);
    if (syms.length) groups[g[1]] = { key: g[1], benchmark: g[2], symbols: syms };
  }
  if (!groups.sp500) groups.sp500 = SECTOR_FALLBACK;

  GROUP_CACHE = groups;
  GROUP_CACHE_AT = now;
  return groups;
}

// ---------------------------------------------------------------------------
// RRG series fetch + per-symbol metric derivation
// ---------------------------------------------------------------------------
async function fetchRRG(symbols, benchmark, months, period) {
  const url =
    `${RRG_BASE}?cmd=getrrgdata2&auth=1&f=json` +
    `&s=${encodeURIComponent(symbols.join(','))}` +
    `&b=${encodeURIComponent(benchmark)}` +
    `&m=${months}&p=${period}`;
  const txt = await getText(url);
  const json = JSON.parse(txt);
  if (!json.rrgdata || !json.rrgdata.length) throw new Error('Empty RRG payload');
  return json;
}

export function quadrantOf(ratio, mom) {
  if (ratio >= 100) return mom >= 100 ? 'Leading' : 'Weakening';
  return mom >= 100 ? 'Improving' : 'Lagging';
}

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Derive per-symbol metrics from a StockCharts RRG payload.
 * tail = number of trading bars in the visible tail. StockCharts' %CHG column
 * is the price change ACROSS THE TAIL (verified against the site's own table
 * for all 11 sectors on 2026-07-31), not a 1-day change.
 */
export function deriveMetrics(payload, symbols, tail) {
  const rows = payload.rrgdata;
  const n = rows.length;
  const names = {};
  (payload.companies || []).forEach((c) => (names[c.symbol] = c.name));

  const out = [];
  for (const sym of symbols) {
    const at = (back) => {
      const row = rows[n - 1 - back];
      return row && row.rrgdata ? row.rrgdata[sym] : null;
    };
    const cur = at(0);
    const prev = at(1);
    const base = at(tail);
    if (!cur || !prev || !base) continue;

    const dRatio = cur.jdkratio - prev.jdkratio;
    const dMom = cur.jdkmom - prev.jdkmom;
    const angle = (Math.atan2(dMom, dRatio) * 180) / Math.PI;
    const magnitude = Math.hypot(dRatio, dMom);
    const chg = 100 * (cur.price / base.price - 1);

    // Visible tail path for plotting: oldest -> newest.
    const path = [];
    for (let i = tail; i >= 0; i--) {
      const p = at(i);
      if (p) path.push([r2(p.jdkratio), r2(p.jdkmom)]);
    }

    out.push({
      symbol: sym,
      name: names[sym] || SECTOR_NAMES[sym] || sym,
      price: r2(cur.price),
      ratio: r2(cur.jdkratio),
      mom: r2(cur.jdkmom),
      dRatio: Math.round(dRatio * 1000) / 1000,
      dMom: Math.round(dMom * 1000) / 1000,
      angle: Math.round(angle * 10) / 10,
      magnitude: Math.round(magnitude * 1000) / 1000,
      chg: r2(chg),
      quadrant: quadrantOf(cur.jdkratio, cur.jdkmom),
      path,
    });
  }
  return { asOf: rows[n - 1].end, bars: n, rows: out };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

// Quadrant weighting: rotation growth is worth most where it is EARLIEST.
// Improving (crossed up, not yet leading) and Lagging-turning-up rank above a
// name already parked in Leading.
const QUAD_WEIGHT = { Improving: 1.3, Lagging: 1.2, Leading: 1.0, Weakening: 0.9 };
// Scores are rescaled by the largest weight so a perfect Improving name lands
// at 100 instead of overflowing into a clipped tie at the top of the table.
const MAX_QUAD_WEIGHT = Math.max(...Object.values(QUAD_WEIGHT));

// Direction quality: peaks at a true 45 degree NE heading, falls to 0 at due
// east (0, drifting right with no momentum gain) and due north (90).
export function angleQuality(angleDeg) {
  if (angleDeg <= 0 || angleDeg >= 90) return 0;
  return Math.sin((2 * angleDeg * Math.PI) / 180);
}

export function percentile(values, v) {
  if (values.length <= 1) return 1;
  let below = 0;
  for (const x of values) if (x < v) below++;
  return below / (values.length - 1);
}

export function scoreCandidates(cands, sectorChgByEtf) {
  const mags = cands.map((c) => c.magnitude);
  const chgs = cands.map((c) => c.chg);
  const secChgs = Object.values(sectorChgByEtf);

  return cands.map((c) => {
    const angQ = angleQuality(c.angle);
    const strQ = percentile(mags, c.magnitude);
    const chgQ = percentile(chgs, c.chg);
    const secQ = percentile(secChgs, sectorChgByEtf[c.sectorEtf]);
    const raw = 0.35 * angQ + 0.25 * strQ + 0.25 * chgQ + 0.15 * secQ;
    const qw = QUAD_WEIGHT[c.quadrant] ?? 1;
    return {
      ...c,
      components: {
        angleQuality: r2(angQ * 100),
        vectorStrength: r2(strQ * 100),
        tailChange: r2(chgQ * 100),
        sectorStrength: r2(secQ * 100),
        quadrantWeight: qw,
      },
      score: r2((100 * raw * qw) / MAX_QUAD_WEIGHT),
    };
  });
}

/**
 * Pick the final list.
 *
 * "spread" mode round-robins across the qualifying sectors (strongest sector
 * first), taking each sector's best remaining candidate before any sector gets
 * a second slot. The point of the tool is to see WHERE rotation is happening,
 * and a pure global ranking lets one hot sector eat every slot — on 2026-07-31
 * a straight top-7 returned 4 healthcare names and skipped XLY, XLF and XLP
 * entirely even though all three qualified.
 *
 * "score" mode is the old behaviour, kept so the two can be compared.
 */
export function selectPicks(scored, sectorOrder, topN, spread) {
  if (!spread) return scored.slice(0, topN);

  const bySector = new Map();
  for (const c of scored) {
    if (!bySector.has(c.sectorEtf)) bySector.set(c.sectorEtf, []);
    bySector.get(c.sectorEtf).push(c); // already score-desc
  }

  const picks = [];
  let placedThisRound = true;
  while (picks.length < topN && placedThisRound) {
    placedThisRound = false;
    for (const sec of sectorOrder) {
      if (picks.length >= topN) break;
      const list = bySector.get(sec);
      if (list && list.length) {
        picks.push(list.shift());
        placedThisRound = true;
      }
    }
  }
  // Selection is spread; presentation stays strongest-first.
  return picks.sort((a, b) => b.score - a.score);
}

// Sunday -> Saturday week bounds for the run's as-of date.
export function weekBounds(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0 = Sunday
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - dow);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const f = (x) => x.toISOString().slice(0, 10);
  return { weekStart: f(start), weekEnd: f(end) };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const q = req.query || {};
  const tail = Math.max(2, Math.min(30, parseInt(q.tail, 10) || 7));
  const months = Math.max(1, Math.min(24, parseInt(q.months, 10) || 3));
  const period = ['d', 'w'].includes(q.period) ? q.period : 'd';
  const minSectorChg = q.minSectorChg !== undefined ? parseFloat(q.minSectorChg) : 0.5;
  const minAngle = q.minAngle !== undefined ? parseFloat(q.minAngle) : 15;
  const maxAngle = q.maxAngle !== undefined ? parseFloat(q.maxAngle) : 90;
  const minMemberChg = q.minMemberChg !== undefined ? parseFloat(q.minMemberChg) : 0;
  const topN = Math.max(1, Math.min(50, parseInt(q.topN, 10) || 7));
  const spread = q.spread === undefined ? true : q.spread === '1' || q.spread === 'true';

  const t0 = Date.now();
  try {
    const groups = await loadGroups();
    const sectorGroup = groups.sp500 || SECTOR_FALLBACK;

    // --- Level 1: the 11 sector ETFs vs SPY ---------------------------------
    const secPayload = await fetchRRG(sectorGroup.symbols, sectorGroup.benchmark, months, period);
    const sectors = deriveMetrics(secPayload, sectorGroup.symbols, tail);
    sectors.rows.forEach((s) => (s.name = SECTOR_NAMES[s.symbol] || s.name));
    sectors.rows.sort((a, b) => b.chg - a.chg);

    const qualifying = sectors.rows.filter((s) => s.chg >= minSectorChg);
    const sectorChgByEtf = {};
    sectors.rows.forEach((s) => (sectorChgByEtf[s.symbol] = s.chg));

    // --- Level 2: members of each qualifying sector, vs their own sector ETF -
    const memberResults = await Promise.all(
      qualifying.map(async (sec) => {
        const gk = sec.symbol.toLowerCase() + 'members';
        const grp = groups[gk];
        if (!grp) return { sector: sec.symbol, error: `no member group ${gk}`, rows: [] };
        try {
          const payload = await fetchRRG(grp.symbols, grp.benchmark || sec.symbol, months, period);
          const m = deriveMetrics(payload, grp.symbols, tail);
          m.rows.forEach((r) => {
            r.sectorEtf = sec.symbol;
            r.sectorName = SECTOR_NAMES[sec.symbol] || sec.symbol;
          });
          return { sector: sec.symbol, benchmark: grp.benchmark, count: m.rows.length, rows: m.rows };
        } catch (e) {
          return { sector: sec.symbol, error: String(e.message || e), rows: [] };
        }
      })
    );

    const allMembers = memberResults.flatMap((m) => m.rows);

    // --- Filter: arrow pointing up AND to the right -------------------------
    const candidates = allMembers.filter(
      (r) =>
        r.dRatio > 0 &&
        r.dMom > 0 &&
        r.angle >= minAngle &&
        r.angle <= maxAngle &&
        r.chg > minMemberChg
    );

    const scored = scoreCandidates(candidates, sectorChgByEtf).sort((a, b) => b.score - a.score);
    const picks = selectPicks(scored, qualifying.map((s) => s.symbol), topN, spread);

    // Per-sector candidate counts, so an empty sector is visibly empty rather
    // than silently absent from the picks.
    const bySector = {};
    qualifying.forEach((s) => (bySector[s.symbol] = 0));
    scored.forEach((c) => (bySector[c.sectorEtf] = (bySector[c.sectorEtf] || 0) + 1));

    const asOfDate = (sectors.asOf || '').slice(0, 10);
    const { weekStart, weekEnd } = weekBounds(asOfDate || new Date().toISOString().slice(0, 10));

    res.status(200).json({
      ok: true,
      asOf: sectors.asOf,
      asOfDate,
      weekStart,
      weekEnd,
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
      params: { tail, months, period, minSectorChg, minAngle, maxAngle, minMemberChg, topN, spread },
      sectors: sectors.rows,
      qualifyingSectors: qualifying.map((s) => s.symbol),
      candidatesBySector: bySector,
      universeSize: allMembers.length,
      candidateCount: scored.length,
      picks,
      candidates: scored,
      members: memberResults.map((m) => ({
        sector: m.sector,
        count: m.rows.length,
        error: m.error || null,
        rows: m.rows,
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}
