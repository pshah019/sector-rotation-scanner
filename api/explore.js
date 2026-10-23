import { loadGroups, SECTOR_NAMES, fetchRRG, trimToDays, deriveMetrics } from './rrg.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  try {
    const groups = await loadGroups();
    const sectorEtfs = Object.keys(SECTOR_NAMES);

    const etf = (req.query.sector || '').toUpperCase();
    if (etf && SECTOR_NAMES[etf]) {
      const gk = etf.toLowerCase() + 'members';
      const grp = groups[gk];
      if (!grp || !grp.symbols?.length)
        return res.status(200).json({ ok: true, sector: etf, name: SECTOR_NAMES[etf], rows: [] });
      const raw = await fetchRRG(grp.symbols, grp.benchmark || etf, 10, 'weekly');
      const pay = trimToDays(raw, 60);
      const rows = deriveMetrics(pay, grp.symbols, 7);
      return res.status(200).json({
        ok: true, sector: etf, name: SECTOR_NAMES[etf],
        benchmark: grp.benchmark || etf, rows,
      });
    }

    const sectors = {};
    for (const s of sectorEtfs) {
      const gk = s.toLowerCase() + 'members';
      const grp = groups[gk];
      sectors[s] = {
        name: SECTOR_NAMES[s],
        benchmark: grp?.benchmark || s,
        symbols: grp?.symbols || [],
      };
    }
    return res.status(200).json({ ok: true, sectors });
  } catch (e) {
    console.error('explore error', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
